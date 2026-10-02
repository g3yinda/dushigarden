'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../server/engine'),{RoomService}=require('../server/rooms');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const players=Array.from({length:6},(_,i)=>({id:'p'+i,name:'猫'+i}));
const all=g=>[...g.deck,...g.discard,...g.exploded,...g.players.flatMap(p=>p.hand),...(g.bomb?[g.bomb]:[])];
const count=(g,t)=>all(g).filter(c=>c.type===t).length;
const configs=[true,false].flatMap(includeImploding=>[true,false].map(includeReverse=>({includeImploding,includeReverse})));
function cmd(s,id,r,type,more={}){return s.command(id,r.code,{commandId:crypto.randomUUID(),revision:r.revision,gameId:r.game?.id,type,...more});}
for(const options of configs){
 test('六人可选牌库 '+JSON.stringify(options),()=>{
  const g=E.createGame(players,{...options,rng:()=>.4});
  assert.equal(count(g,'imploding'),options.includeImploding?1:0);
  assert.equal(count(g,'bomb'),options.includeImploding?4:5);
  assert.equal(count(g,'reverse'),options.includeReverse?4:0);
  for(const [t,n] of Object.entries({targetAttack:3,bottom:4,alterFuture:4,feral:4,defuse:6}))assert.equal(count(g,t),n);
  assert.equal(g.totalCards,options.includeReverse?76:72);assert.equal(g.deck.length,options.includeReverse?28:24);
  assert(g.players.every(p=>p.hand.length===8));E.assertInvariant(g);
  const v=E.project(g,'p0');assert.equal(v.options.includeImploding,options.includeImploding);assert.equal(v.options.includeReverse,options.includeReverse);
 });
 test('四组合20局抽牌拆弹直到唯一胜者 '+JSON.stringify(options),()=>{
  for(let seed=1;seed<=20;seed++){
   let x=seed,rng=()=>((x=(x*1664525+1013904223)>>>0)/2**32),g=E.createGame(players,{...options,rng,now:1}),steps=0;
   while(g.phase!=='finished'&&steps++<1000){
    const a=g.phase==='action'?{type:'draw'}:g.phase==='defuse'?{type:'defuse'}:{type:'insert',position:g.deck.length+1};
    g=E.command(g,g.current,a,{now:steps+1,rng});E.assertInvariant(g);
    assert.equal(count(g,'reverse'),options.includeReverse?4:0);assert.equal(count(g,'imploding'),options.includeImploding?1:0);
   }
   assert.equal(g.phase,'finished');assert.equal(g.players.filter(p=>p.alive).length,1);assert(g.winner);
  }
 });
}
test('2–5人忽略扩展开关，六人省略开关默认完整扩展',()=>{
 for(const n of [2,3,4,5])for(const options of configs){const g=E.createGame(players.slice(0,n),options);assert.equal(count(g,'reverse'),0);assert.equal(count(g,'imploding'),0);assert.equal(g.deck.length,{2:35,3:29,4:23,5:16}[n]);E.assertInvariant(g);}
 const g=E.createGame(players);assert.equal(count(g,'imploding'),1);assert.equal(count(g,'reverse'),4);
});
test('引擎与房间拒绝非布尔开关且不建房',()=>{
 const s=new RoomService(),id=s.session({name:'小白'}).player.id;
 for(const key of ['includeImploding','includeReverse'])for(const bad of [0,1,'false',null,[],{}]){
  assert.throws(()=>E.createGame(players,{[key]:bad}),/布尔/);assert.throws(()=>s.create(id,{[key]:bad}),/布尔/);assert.equal(Object.keys(s.rooms).length,0);
 }
});
test('六人Bot房公开/快照恢复/再开保留关闭项',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boomcat-optional-'));
 try{
  const file=path.join(dir,'state.json'),s=new RoomService({file,allowBots:true}),id=s.session({name:'小白'}).player.id;
  let r=s.create(id,{includeImploding:false,includeReverse:false});assert.equal(r.options.includeImploding,false);assert.equal(r.options.includeReverse,false);
  r=cmd(s,id,r,'addBots',{count:5,respondNope:false});r=cmd(s,id,r,'ready',{ready:true});r=cmd(s,id,r,'start');assert.equal(count(s.rooms[r.code].game,'bomb'),5);assert.equal(count(s.rooms[r.code].game,'reverse'),0);
  const restored=new RoomService({file,allowBots:true});assert.equal(restored.view(id,r.code).options.includeReverse,false);assert.equal(count(restored.rooms[r.code].game,'imploding'),0);
  restored.rooms[r.code].status='finished';restored.rooms[r.code].game.phase='finished';
  r=cmd(restored,id,restored.view(id,r.code),'rematch');r=cmd(restored,id,r,'ready',{ready:true});r=cmd(restored,id,r,'start');assert.equal(count(restored.rooms[r.code].game,'imploding'),0);assert.equal(count(restored.rooms[r.code].game,'reverse'),0);E.assertInvariant(restored.rooms[r.code].game);
  const data=JSON.parse(fs.readFileSync(file));for(const room of Object.values(data.rooms))for(const options of [room.options,room.game.options]){delete options.includeImploding;delete options.includeReverse;}fs.writeFileSync(file,JSON.stringify(data));
  const legacy=new RoomService({file});assert.equal(legacy.view(id,r.code).options.includeImploding,true);assert.equal(legacy.view(id,r.code).options.includeReverse,true);assert.equal(count(legacy.rooms[r.code].game,'imploding'),0); // Existing deck is never rebuilt.
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('关闭反转后，三张组合不能声明索取反转，失败不扣牌',()=>{
 const g=E.createGame(players,{includeReverse:false,rng:()=>.4});g.current='p0';const p=g.players[0];
 const cards=all(g).filter(c=>c.type==='cat1').slice(0,3);for(const c of cards){for(const zone of [g.deck,...g.players.map(p=>p.hand)]){const i=zone.indexOf(c);if(i>=0)zone.splice(i,1);}p.hand.push(c);}E.assertInvariant(g);
 const before=structuredClone(g);assert.throws(()=>E.command(g,'p0',{type:'play',cards:cards.map(c=>c.id),target:'p1',named:'reverse'}),/牌名|启用/);assert.deepEqual(g,before);
});
