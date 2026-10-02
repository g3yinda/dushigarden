const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../server/engine');
const opts = { now: 1000, rng: () => .4 };
function game() {
  let g = E.createGame(['a','b','c'].map(id => ({id,name:id,avatar:0})), opts);
  // Reassign existing cards, preserving conservation.
  const all = [...g.deck, ...g.players.flatMap(p => p.hand)];
  const take = type => all.splice(all.findIndex(c => c.type === type), 1)[0];
  g.players.forEach(p => p.hand = []);
  g.players[0].hand = [take('attack'), take('nope')];
  g.players[1].hand = [take('nope')];
  g.deck = all;
  g.current = "a";
  return E.command(g, 'a', {type:'play',cards:[g.players[0].hand[0].id]}, opts);
}
function pass(g,id,layer=g.pending.nopeCount) {
  return E.command(g,id,{type:'passNope',nopeCount:layer},opts);
}
test('本层不出由服务器保存且不能撤回或重复选择，不消耗牌', () => {
  const original = game(), g = pass(original,'b');
  assert.equal(g.pending.responses.b,'passed');
  assert.deepEqual(g.players[1].hand,original.players[1].hand);
  assert.equal(original.pending.responses.b,'waiting');
  assert.throws(()=>pass(g,'b'),/已完成/);
  assert.throws(()=>E.command(g,'b',{type:'nope',cardId:g.players[1].hand[0].id},opts),/已完成/);
  assert.equal(E.project(g,'b').pending.responses.b,'passed');
  E.assertInvariant(g);
});
test('所有持否定玩家确认后立即结算，无牌者自动完成', () => {
  let g = game(), deadline = g.deadline;
  g = pass(g,'a'); g = pass(g,'b');
  assert.equal(g.phase,'action');
  assert.equal(g.current,'b');
  assert.equal(g.remaining,2);
  assert(opts.now < deadline);
  E.assertInvariant(g);
});
test('否定新层清除旧层放弃；出牌者完成响应；全员确认按奇偶结算', () => {
  let g = pass(game(),'a');
  g = E.command(g,'b',{type:'nope',nopeCount:0,cardId:g.players[1].hand[0].id},opts);
  assert.deepEqual(g.pending.responses,{a:'waiting',b:'played',c:'passed'});
  assert.throws(()=>pass(g,'a',0),/窗口已变化/);
  g = E.command(g,'a',{type:'nope',nopeCount:1,cardId:g.players[0].hand[0].id},opts);
  assert.equal(g.pending,null);
  assert.equal(g.current,'b'); assert.equal(g.remaining,2);
  let canceled = game();
  canceled = E.command(canceled,'b',{type:'nope',cardId:canceled.players[1].hand[0].id},opts);
  canceled = pass(canceled,'a');
  assert.equal(canceled.current,'a'); assert.equal(canceled.pending,null);
  E.assertInvariant(g); E.assertInvariant(canceled);
});
test('迟到不出被拒绝，到期自动结算；旧快照响应表缺失兼容', () => {
  const g = game();
  assert.throws(()=>E.command(g,'b',{type:'passNope',nopeCount:0},{...opts,now:g.deadline}),e=>e.code==='STALE');
  assert.equal(E.tick(pass(g,'a'),{...opts,now:g.deadline}).phase,'action');
  delete g.pending.responses;
  assert.deepEqual(E.project(g,'a').pending.responses,{a:'waiting',b:'waiting',c:'passed'});
  assert.equal(pass(g,'a').pending.responses.a,'passed');
});
test('服务端不出幂等、刷新/快照恢复仍锁定；全员确认发出版本更新', () => {
  const {RoomService} = require('../server/rooms');
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'boomcat-response-'));
  try {
    const file = path.join(dir,'state.json'), s = new RoomService({file,now:()=>1000});
    const a = s.session({name:'甲'}).player.id, b = s.session({name:'乙'}).player.id;
    let r=s.create(a); s.join(b,r.code);
    let counter=0;
    const move = (svc,id,type,extra={}) => {
      const v=svc.view(id,r.code);
      return svc.command(id,r.code,{type,revision:v.revision,gameId:v.game?.id,commandId:'response-'+ ++counter,...extra});
    };
    move(s,a,'ready',{ready:true}); move(s,b,'ready',{ready:true}); move(s,a,'start');
    const raw = s.rooms[r.code], g = raw.game;
    // Reuse the production service with an arranged, invariant-preserving game.
    const all=[...g.deck,...g.players.flatMap(p=>p.hand)];
    const attack=all.splice(all.findIndex(c=>c.type==='attack'),1)[0];
    const nope=all.splice(all.findIndex(c=>c.type==='nope'),1)[0];
    const ownNope=all.splice(all.findIndex(c=>c.type==='nope'),1)[0];
    g.players[0].hand=[attack,ownNope]; g.players[1].hand=[nope]; g.deck=all; g.current=a;
    move(s,a,'play',{cards:[attack.id]});
    const v=s.view(b,r.code);
    const payload={type:'passNope',nopeCount:0,revision:v.revision,gameId:v.game.id,commandId:'pass-once'};
    const after=s.command(b,r.code,payload);
    assert.equal(after.game.pending.responses[b],'passed');
    assert.equal(s.command(b,r.code,payload).revision,after.revision);
    const recovered=new RoomService({file,now:()=>1000});
    assert.equal(recovered.view(b,r.code).game.pending.responses[b],'passed');
    assert.throws(()=>move(recovered,b,'nope',{cardId:nope.id,nopeCount:0}),/已完成/);
    let events=0; recovered.on(r.code,()=>events++);
    const done=move(recovered,a,'passNope',{nopeCount:0});
    assert.equal(done.game.phase,'action'); assert.equal(done.game.current,b);
    assert.equal(events,1); E.assertInvariant(recovered.rooms[r.code].game);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
for (const nopeSeconds of [0, 10]) test(`四个 Bot 均确认，其他响应不重置思考时间，否定时长${nopeSeconds}`, () => {
  const {RoomService} = require('../server/rooms'), {BotRunner} = require('../server/bots');
  let now=1000;
  const s=new RoomService({allowBots:true,now:()=>now});
  const host=s.session({name:'验证'}).player.id;
  let r=s.create(host,{nopeSeconds,noTurnTimer:true}), serial=0;
  const move=(type,extra={})=>{
    r=s.view(host,r.code);
    return r=s.command(host,r.code,{type,...extra,revision:r.revision,gameId:r.game?.id,commandId:'bot-response-'+ ++serial});
  };
  move('addBots',{count:4,respondNope:false}); move('ready',{ready:true}); move('start');
  const g=s.rooms[r.code].game;
  const all=[...g.deck,...g.players.flatMap(p=>p.hand)];
  const attack=all.splice(all.findIndex(c=>c.type==='attack'),1)[0];
  g.players.forEach(p=>p.hand=[]); g.players[0].hand=[attack];
  for(const p of g.players.slice(1))p.hand=[all.splice(all.findIndex(c=>c.type==='nope'),1)[0]];g.deck=all; g.current=host;
  move('play',{cards:[attack.id]});
  const runner=new BotRunner(s,{now:()=>now,rng:()=>.5});
  runner.step();
  for (let i=0;i<4;i++) {now=2500+i*100; runner.step();}
  assert.equal(s.view(host,r.code).game.phase,'action');
  assert(now < 6000); E.assertInvariant(s.rooms[r.code].game);
});
