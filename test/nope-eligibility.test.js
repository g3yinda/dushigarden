const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../server/engine');
const { RoomService } = require('../server/rooms');
const opts = { now: 1000, rng: () => .4, id: 'eligibility' };
function arranged(hands, n=3) {
  const g=E.createGame(Array.from({length:n},(_,i)=>({id:'p'+i,name:'猫'+i})),opts);
  const all=[...g.deck,...g.players.flatMap(p=>p.hand)];
  const take=type=>{const i=all.findIndex(c=>c.type===type);assert(i>=0);return all.splice(i,1)[0];};
  g.players.forEach((p,i)=>p.hand=(hands[i]||[]).map(take));g.deck=all;g.current='p0';return g;
}
const act=(g,id,type,extra={})=>E.command(g,id,{type,...extra},opts);
test('无人持有否定时出牌立即生效，无否定倒计时',()=>{
  let g=arranged([['attack'],['defuse'],[]]);
  g=act(g,'p0','play',{cards:[g.players[0].hand[0].id]});
  assert.equal(g.phase,'action');assert.equal(g.current,'p1');assert.equal(g.remaining,2);assert.equal(g.pending,null);E.assertInvariant(g);
});
test('只等待持有否定的玩家；无牌、已出局者无需选择',()=>{
  let g=arranged([['attack','nope'],['nope'],[]]);
  g=act(g,'p0','play',{cards:[g.players[0].hand[0].id]});
  assert.equal(g.pending.responses.p2,'passed');
  assert.throws(()=>act(g,'p2','passNope',{nopeCount:0}));
  g=act(g,'p0','passNope',{nopeCount:0});g=act(g,'p1','passNope',{nopeCount:0});
  assert.equal(g.phase,'action');assert.equal(g.current,'p1');E.assertInvariant(g);
});
test('最后一位持牌者打出否定，无人能反否定时立即取消动作',()=>{
  let g=arranged([['attack'],['nope'],[]]);
  g=act(g,'p0','play',{cards:[g.players[0].hand[0].id]});
  g=act(g,'p1','nope',{cardId:g.players[1].hand[0].id,nopeCount:0});
  assert.equal(g.phase,'action');assert.equal(g.current,'p0');assert.equal(g.pending,null);E.assertInvariant(g);
});
test('用否定组成对子后按剩余手牌决定响应资格',()=>{
  let g=arranged([['nope','nope'],['defuse'],[]]);
  g=act(g,'p0','play',{cards:g.players[0].hand.map(c=>c.id),target:'p1'});
  assert.equal(g.phase,'action');assert.equal(g.players[0].hand[0].type,'defuse');E.assertInvariant(g);
});
test('旧快照无牌等待者被自动排除，不等截止结算',()=>{
  const g=arranged([['attack'],[],[]]);
  const card=g.players[0].hand.shift();g.discard.push(card);
  g.pending={actor:'p0',type:'attack',nopeCount:0,responses:{p0:'waiting',p1:'waiting',p2:'waiting'}};
  g.phase='nope';g.deadline=11000;
  const done=E.tick(g,opts);assert.equal(done.phase,'action');assert.equal(done.current,'p1');assert.equal(g.phase,'nope');E.assertInvariant(done);
});
for(const type of ['attack','skip','favor','shuffle','future','targetAttack','reverse','bottom','alterFuture'])test(`${type} 有持牌者才开窗口，牌本身仍可否定`,()=>{
  const n=['targetAttack','reverse','bottom','alterFuture'].includes(type)?6:3;
  let g=arranged([[type],['nope','defuse']],n);
  g=act(g,'p0','play',{cards:[g.players[0].hand[0].id],target:'p1'});
  assert.equal(g.phase,'nope');assert.equal(g.pending.responses.p0,'passed');assert.equal(g.pending.responses.p1,'waiting');
  g=act(g,'p1','nope',{cardId:g.players[1].hand.find(c=>c.type==='nope').id,nopeCount:0});
  assert.equal(g.phase,'action');assert.equal(g.current,'p0');E.assertInvariant(g);
});
function serviceGame(){
 const s=new RoomService({now:()=>1000});const ids=['甲','乙','丙'].map(name=>s.session({name}).player.id);
 let r=s.create(ids[0]);for(const id of ids.slice(1))r=s.join(id,r.code);let serial=0;
 const move=(id,type,extra={})=>{const v=s.view(id,r.code);return s.command(id,r.code,{type,...extra,commandId:'s'+ ++serial,revision:v.revision,gameId:v.game?.id});};
 for(const id of ids)move(id,'ready',{ready:true});move(ids[0],'start');
 const g=s.rooms[r.code].game,all=[...g.deck,...g.players.flatMap(p=>p.hand)],take=type=>all.splice(all.findIndex(c=>c.type===type),1)[0];
 g.players[0].hand=[take('attack'),take('nope')];g.players[1].hand=[take('nope')];g.players[2].hand=[take('nope')];g.deck=all;g.current=ids[0];
 move(ids[0],'play',{cards:[g.players[0].hand[0].id]});
 return {s,ids,r,move};
}
function responsePayload(v,type,extra={}){const p=v.game.pending;return {type,...extra,revision:v.revision,gameId:v.game.id,commandId:'once-'+type,nopeCount:p.nopeCount,nopeWindow:JSON.stringify([v.code,v.game.id,p.actor,p.type,p.nopeCount,v.game.deadline,p.actionId??null])};}
for(const type of ['nope','passNope'])test(`同窗口别人已不出后 ${type} 首次点击仍成功，幂等且旧层不重放`,()=>{
 const {s,ids,r,move}=serviceGame(),v=s.view(ids[1],r.code);
 const payload=responsePayload(v,type,{cardId:v.game.hand[0].id});move(ids[0],'passNope',{nopeCount:0});
 const after=s.command(ids[1],r.code,payload);assert.equal(after.game.pending.responses[ids[1]],type==='nope'?'played':'passed');
 assert.equal(s.command(ids[1],r.code,payload).revision,after.revision);
 const stale=responsePayload(v,'nope',{cardId:s.view(ids[2],r.code).game.hand[0].id});stale.commandId='late-other';
 if(type==='nope')assert.throws(()=>s.command(ids[2],r.code,stale),e=>e.code==='STALE');
 assert.throws(()=>s.command(ids[1],r.code,{...payload,commandId:'twice'}));
 assert.throws(()=>s.command(ids[2],r.code,{...stale,nopeWindow:stale.nopeWindow+'wrong',commandId:'wrong'}),e=>e.code==='STALE');
 E.assertInvariant(s.rooms[r.code].game);
});
test('无窗口凭据的陈旧响应与普通操作仍拒绝',()=>{
 const {s,ids,r,move}=serviceGame(),v=s.view(ids[1],r.code);move(ids[0],'passNope',{nopeCount:0});
 const payload=responsePayload(v,'passNope');delete payload.nopeWindow;
 assert.throws(()=>s.command(ids[1],r.code,payload),e=>e.code==='STALE');
 assert.throws(()=>s.command(ids[1],r.code,{...payload,type:'draw',commandId:'stale-draw'}),e=>e.code==='STALE');
});
test('同毫秒相同玩家相同牌种的后续动作也不能接收旧窗口响应',()=>{
 const {s,ids,r,move}=serviceGame(),old=s.view(ids[1],r.code),payload=responsePayload(old,'nope',{cardId:old.game.hand[0].id});
 for(const id of ids)move(id,'passNope',{nopeCount:0});
 const g=s.rooms[r.code].game,card=g.deck.splice(g.deck.findIndex(c=>c.type==='attack'),1)[0];
 g.players[0].hand.push(card);g.current=ids[0];move(ids[0],'play',{cards:[card.id]});
 assert.equal(s.view(ids[1],r.code).game.phase,'nope');
 assert.throws(()=>s.command(ids[1],r.code,payload),e=>e.code==='STALE');E.assertInvariant(s.rooms[r.code].game);
});
test('普通抽牌、炸弹拆弹与秘密插回不会进入否定窗口',()=>{
 let g=arranged([['defuse'],['nope'],[]]);
 const i=g.deck.findIndex(c=>c.type==='bomb');g.deck.unshift(g.deck.splice(i,1)[0]);
 g=act(g,'p0','draw');assert.equal(g.phase,'defuse');assert.equal(g.pending,null);
 g=act(g,'p0','defuse');assert.equal(g.phase,'insert');assert.equal(g.pending,null);
 g=act(g,'p0','insert',{position:2});assert.equal(g.phase,'action');assert.equal(g.pending,null);E.assertInvariant(g);
});
