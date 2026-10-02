const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../server/engine');
const { RoomService } = require('../server/rooms');
function arranged(options) {
  const g = E.createGame(['a','b','c'].map(id => ({id,name:id})), {now:1000,...options});
  const all = [...g.deck,...g.players.flatMap(p=>p.hand)];
  const take = type => all.splice(all.findIndex(c=>c.type===type),1)[0];
  g.players.forEach(p=>p.hand=[]);
  g.players[0].hand=[take('attack'),take('nope'),take('nope')];
  g.players[1].hand=[take('nope'),take('nope')];
  g.players[2].hand=[take('nope')];g.deck=all;g.current='a';
  return E.command(g,'a',{type:'play',cards:[g.players[0].hand[0].id]},{now:1000});
}
for (const allowNopeChain of [false,true]) test(`可循环否定=${allowNopeChain}决定首张否定后是否再开窗口`,()=>{
  let g=arranged({allowNopeChain});
  g=E.command(g,'b',{type:'nope',nopeCount:0,cardId:g.players[1].hand[0].id},{now:2000});
  assert.equal(g.phase,allowNopeChain?'nope':'action');
  if(allowNopeChain){assert.equal(g.pending.nopeCount,1);assert.equal(g.deadline,12000);}
  else {assert.equal(g.pending,null);assert.equal(g.current,'a');assert.equal(g.remaining,1);}
  E.assertInvariant(g);
});
for(const count of [1,2,3,4]) test(`循环否定${count}层后原动作只按奇偶结算一次`,()=>{
  let g=arranged({allowNopeChain:true});
  for(let i=0;i<count;i++){
    const id=i%2?'a':'b', p=g.players.find(p=>p.id===id);
    g=E.command(g,id,{type:'nope',nopeCount:i,cardId:p.hand.find(c=>c.type==='nope').id},{now:2000+i*100});
  }
  assert.throws(()=>E.command(g,'c',{type:'passNope',nopeCount:count-1},{now:3000}),e=>e.code==='STALE');
  for(const p of g.players) if(g.phase==='nope'&&g.pending.responses[p.id]==='waiting')
    g=E.command(g,p.id,{type:'passNope',nopeCount:count},{now:3000});
  assert.equal(g.current,count%2?'a':'b');assert.equal(g.remaining,count%2?1:2);
  assert.equal(g.discard.length,count+1);E.assertInvariant(g);
});
test('不限时否定不自动过期，全部确认后立即结算且仍可反否定',()=>{
  let g=arranged({nopeSeconds:0,allowNopeChain:true});assert.equal(g.deadline,null);
  assert.equal(E.tick(g,{now:99999999}),g);
  g=E.command(g,'b',{type:'nope',nopeCount:0,cardId:g.players[1].hand[0].id},{now:99999999});
  assert.equal(g.deadline,null);
  for(const p of g.players)if(g.phase==='nope'&&g.pending.responses[p.id]==='waiting')
    g=E.command(g,p.id,{type:'passNope',nopeCount:1},{now:99999999});
  assert.equal(g.phase,'action');assert.equal(g.current,'a');E.assertInvariant(g);
});
test('建房四档与开关严格校验，开局及再开保留选项',()=>{
 for(const nopeSeconds of [10,20,30,0])for(const allowNopeChain of [true,false]){
  const s=new RoomService({now:()=>1000});const a=s.session().player.id,b=s.session().player.id;
  let r=s.create(a,{nopeSeconds,allowNopeChain});s.join(b,r.code);
  const move=(id,type,extra={})=>{const v=s.view(id,r.code);return s.command(id,r.code,{type,revision:v.revision,gameId:v.game?.id,commandId:require('node:crypto').randomUUID(),...extra});};
  move(a,'ready',{ready:true});move(b,'ready',{ready:true});r=move(a,'start');
  assert.equal(r.game.options.allowNopeChain,allowNopeChain);assert.equal(r.options.nopeSeconds,nopeSeconds);
  s.rooms[r.code].status='finished';r=move(a,'rematch');assert.equal(r.options.allowNopeChain,allowNopeChain);assert.equal(r.options.nopeSeconds,nopeSeconds);
 }
 const s=new RoomService(),a=s.session().player.id;
 for(const nopeSeconds of [5,15,null,'20',Infinity,-1])assert.throws(()=>s.create(a,{nopeSeconds}));
 for(const allowNopeChain of [null,'false',0])assert.throws(()=>s.create(a,{allowNopeChain}));
});
for (const noTurnTimer of [true,false]) test(`不限时否定离线只代替该玩家不出，在线玩家继续等待(${noTurnTimer})`,()=>{
 let now=1000;const s=new RoomService({now:()=>now});const ids=['a','b','c'].map(name=>s.session({name}).player.id);
 let r=s.create(ids[0],{nopeSeconds:0,noTurnTimer});s.join(ids[1],r.code);s.join(ids[2],r.code);
 const raw=s.rooms[r.code];raw.status='playing';raw.game=arranged({...raw.options});
 // Bind arranged seats to the real room identities without changing conserved cards.
 const g=raw.game;const map=Object.fromEntries(['a','b','c'].map((id,i)=>[id,ids[i]]));
 g.players.forEach(p=>p.id=map[p.id]);g.current=map[g.current];g.pending.actor=map[g.pending.actor];g.pending.responses=Object.fromEntries(Object.entries(g.pending.responses).map(([id,value])=>[map[id],value]));
 g.privateLogs=Object.fromEntries(Object.entries(g.privateLogs).map(([id,value])=>[map[id],value]));
 raw.players[0].away=true;
 s.touch(ids[1],raw);s.touch(ids[2],raw);s.tick();now=11000;s.touch(ids[1],raw);s.touch(ids[2],raw);s.tick();
 assert.equal(raw.game.phase,'nope');assert.equal(raw.game.deadline,null);assert.equal(raw.game.pending.responses[ids[0]],'passed');assert.equal(raw.game.pending.responses[ids[1]],'waiting');
 assert.equal(raw.offlineTurn ?? null,null);E.assertInvariant(raw.game);
});
test('旧房5/15秒与缺失循环开关恢复后沿用，不改变正在响应的截止',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boomcat-cyclic-'));
 try {for(const seconds of [5,15]){
 const s=new RoomService({now:()=>1000});const a=s.session().player.id;const r=s.create(a);
 s.rooms[r.code].options.nopeSeconds=seconds;delete s.rooms[r.code].options.allowNopeChain;s.file=path.join(dir,'state.json');s.save();
 const recovered=new RoomService({file:s.file,now:()=>1000});assert.equal(recovered.current(a).options.nopeSeconds,seconds);assert.equal(recovered.current(a).options.allowNopeChain,true);
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
