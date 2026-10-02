'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/index'),{RoomService}=require('../server/rooms'),{chooseAction}=require('../server/bots');
const scenarios=[2,3,4,5,6].map(n=>({n,includeImploding:true,includeReverse:true}));
for(const includeImploding of [true,false])for(const includeReverse of [true,false])if(!includeImploding||!includeReverse)scenarios.push({n:6,includeImploding,includeReverse});
for(const options of scenarios)test(`HTTP真实接口完整对局、恢复与再开 ${JSON.stringify(options)}`,async t=>{
 let now=1000;const service=new RoomService({now:()=>now}),server=createServer({service,mode:'local'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 async function req(path,body,token){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,200,`${path}: ${data?.error}`);return data;}
 const people=[];for(let i=0;i<options.n;i++)people.push(await req('/session',{name:'接口验收'+i,avatar:i%4}));
 const owner=people[0],byId=new Map(people.map(p=>[p.player.id,p]));let r=await req('/rooms',{...options,noTurnTimer:true,nopeSeconds:0},owner.token),code=r.code;
 async function cmd(actor,action){if(r.me!==actor)r=await req('/rooms/'+code,null,byId.get(actor).token);r=await req('/rooms/'+code+'/command',{...action,revision:r.revision,gameId:r.game?.id,commandId:crypto.randomUUID()},byId.get(actor).token);return r;}
 for(const p of people.slice(1))r=await req('/rooms/join',{code},p.token);
 for(const p of people)await cmd(p.player.id,{type:'ready',ready:true});
 await cmd(owner.player.id,{type:'start'});const gameId=r.game.id;
 assert.equal(r.game.rulesVersion,options.n===6?'ek-imploding-2023-online-v1':'ek-original-2025-online-v1');
 const memory=new Map();let steps=0;
 while(r.game.phase!=='finished'&&steps++<1000){
  const g=r.game,actor=g.phase==='favor'?g.pending.target:g.phase==='nope'?Object.keys(g.pending.responses).find(id=>g.pending.responses[id]==='waiting'):g.current;
  if(r.me!==actor)r=await req('/rooms/'+code,null,byId.get(actor).token);
  assert(r.game.players.every(p=>!p.hand));assert(!('deck' in r.game));
  const key=[r.game.turnNumber,r.game.current,r.game.remaining,actor].join(':');
  // Deterministic strategy limits ordinary plays and cannot read server-private data.
  const action=chooseAction(r,{rng:()=>.47,played:memory.get(key)||0,respondNope:false});assert(action);
  if(action.type==='play')memory.set(key,(memory.get(key)||0)+1);
  now++;await cmd(actor,action);
  if(steps===15){const restored=await req('/rooms/current',null,byId.get(actor).token);assert.equal(restored.game.id,gameId);assert.equal(restored.revision,r.revision);}
 }
 assert.equal(r.game.phase,'finished');assert(r.game.winner);assert.equal(r.game.players.filter(p=>p.alive).length,1);
 await cmd(owner.player.id,{type:'rematch'});assert.equal(r.status,'waiting');assert.equal(r.game,null);assert(r.players.every(p=>!p.ready));
 for(const p of people)await cmd(p.player.id,{type:'ready',ready:true});await cmd(owner.player.id,{type:'start'});assert.notEqual(r.game.id,gameId);assert.equal(r.options.includeImploding,options.includeImploding);assert.equal(r.options.includeReverse,options.includeReverse);
 await cmd(owner.player.id,{type:'closeRoom'});assert.equal(r.status,'closed');for(const p of people)assert.equal(await req('/rooms/current',null,p.token),null);
});
