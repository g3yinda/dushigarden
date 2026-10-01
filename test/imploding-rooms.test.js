'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../server/engine'),{RoomService}=require('../server/rooms');
function setup(){let now=1000;const s=new RoomService({now:()=>now}),ids=Array.from({length:6},(_,i)=>s.session({name:'猫'+i}).player.id);let r=s.create(ids[0],{noTurnTimer:true});for(const id of ids.slice(1))r=s.join(id,r.code);for(const id of ids)r=cmd(s,id,r,'ready',{ready:true});r=cmd(s,ids[0],r,'start');return{s,ids,r,time:n=>now=n};}
function cmd(s,id,r,type,more={}){return s.command(id,r.code,{commandId:crypto.randomUUID(),revision:r.revision,gameId:r.game?.id,type,...more});}
function moveToHand(g,id,type){const p=g.players.find(p=>p.id===id);if(p.hand.some(c=>c.type===type))return p.hand.find(c=>c.type===type).id;for(const zone of [g.deck,...g.players.map(p=>p.hand)]){const i=zone.findIndex(c=>c.type===type);if(i>=0){const c=zone.splice(i,1)[0];p.hand.push(c);return c.id;}}throw Error(type);}
test('不限时调整未来：离线只在托管截止后原序关闭，在线重连取消托管',()=>{
 const x=setup(),{s,ids,time}=x;let r=x.r,g=s.rooms[r.code].game,id=g.current;const card=moveToHand(g,id,'alterFuture');r=s.view(id,r.code);r=cmd(s,id,r,'play',{cards:[card]});for(const p of ids)if(r.game.phase==='nope' && r.game.pending.responses[p]==='waiting')r=cmd(s,p,r,'passNope',{nopeCount:0});assert.equal(r.game.phase,'alterFuture');assert.equal(r.game.deadline,null);
 const before=structuredClone(s.rooms[r.code].game.deck);time(2000);r=cmd(s,id,s.view(id,r.code),'leave');s.tick();assert.equal(s.rooms[r.code].offlineTurn.deadline,12000);time(11999);for(const p of ids.filter(p=>p!==id))s.touch(p,s.rooms[r.code]);s.tick();assert.equal(s.rooms[r.code].game.phase,'alterFuture');
 s.touch(id,s.rooms[r.code]);assert.equal(s.rooms[r.code].offlineTurn,null);s.tick();assert.equal(s.rooms[r.code].game.phase,'alterFuture');
 time(12000);r=cmd(s,id,s.view(id,r.code),'leave');s.tick();time(22000);for(const p of ids.filter(p=>p!==id))s.touch(p,s.rooms[r.code]);s.tick();assert.equal(s.rooms[r.code].game.phase,'action');assert.equal(s.rooms[r.code].game.deadline,null);assert.deepEqual(s.rooms[r.code].game.deck,before);E.assertInvariant(s.rooms[r.code].game);
});
