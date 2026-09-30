const test = require('node:test');
const assert = require('node:assert/strict');
const {RoomService} = require('../server/rooms');
const E = require('../server/engine');
function cmd(s,id,r,type,extra={}) {
  return s.command(id,r.code,{type,...extra,revision:r.revision,gameId:r.game?.id,commandId:require('node:crypto').randomUUID()});
}
test('第六位可加入且取消准备；第七位拒绝，不改变房间', () => {
  const s=new RoomService({now:()=>1000});
  const players=Array.from({length:7},(_,i)=>s.session({name:'猫'+i}).player.id);
  let r=s.create(players[0]);
  for (const p of players.slice(1,5)) r=s.join(p,r.code);
  for (const p of players.slice(0,5)) r=cmd(s,p,r,'ready',{ready:true});
  r=s.join(players[5],r.code);
  assert.equal(r.players.length,6); assert(r.players.every(p=>!p.ready));
  const before=structuredClone(s.rooms[r.code]);
  assert.throws(()=>s.join(players[6],r.code),/房间已满/);
  assert.deepEqual(s.rooms[r.code],before);
  for (const p of players.slice(0,6)) r=cmd(s,p,r,'ready',{ready:true});
  r=cmd(s,players[0],r,'start');
  assert.equal(r.game.players.length,6); assert.equal(r.game.deckCount,28);
  assert.equal(s.rooms[r.code].game.rulesVersion,'ek-imploding-2023-online-v1');
});
test('一位房主加五只 Bot，满席不能再添加；生产模式仍禁止 Bot', () => {
  const s=new RoomService({allowBots:true,now:()=>1000}), id=s.session({name:'房主'}).player.id;
  let r=s.create(id);
  r=cmd(s,id,r,'addBots',{count:5,respondNope:true});
  assert.equal(r.players.length,6); assert.equal(r.players.filter(p=>p.isBot).length,5);
  assert.throws(()=>cmd(s,id,r,'addBots',{count:1,respondNope:false}),/不能超过 6 人/);
  r=cmd(s,id,r,'ready',{ready:true}); r=cmd(s,id,r,'start');
  E.assertInvariant(s.rooms[r.code].game);
  const production=new RoomService(), p=production.session({name:'测试'}).player.id;
  assert.throws(()=>cmd(production,p,production.create(p),'addBots',{count:5,respondNope:true}),e=>e.status===403);
});
test('六人完整扩展总76张、每人1拆弹、无额外拆弹；7人不支持', () => {
  const players=Array.from({length:7},(_,i)=>({id:String(i),name:'猫'+i}));
  const g=E.createGame(players.slice(0,6),{rng:()=>.5,now:1000});
  assert.equal(g.totalCards,76);
  assert.equal(g.deck.filter(c=>c.type==='defuse').length,0);
  assert.equal(g.players.flatMap(p=>p.hand).filter(c=>c.type==='defuse').length,6);
  assert.equal(g.deck.filter(c=>c.type==='bomb').length,4);
  assert.equal(g.deck.filter(c=>c.type==='imploding').length,1);
  assert.throws(()=>E.createGame(players),/2–6/);
});
