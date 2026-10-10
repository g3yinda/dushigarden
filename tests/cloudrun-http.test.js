"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createApiTransport} = require("../miniprogram/lib/api-transport");
const config = require("../miniprogram/config.cloudrun.example");
const {createServer} = require("../server/index");
const {RoomService} = require("../server/rooms");

// Cloud SDK, identity exchange and nickname checker are fixtures; business requests use real HTTP.
for (const count of [2, 6]) test(`云托管传输契约与wechat后端完成${count}人登录、加入、开局、抽牌、关房`, async t => {
  const service = new RoomService();
  const server = createServer({service, mode:"wechat", exchangeCode:async code=>`fixture-${code}`,
    checkNickname:async()=>({traceId:"fixture-pass"})});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = createApiTransport({cloud:{init(){}, async callContainer(options){
    assert.equal(options.config.env, config.cloudRunEnv);
    assert.equal(options.header["X-WX-SERVICE"], "boomcat");
    assert.equal(options.header["X-Boomcat-Debug"], undefined);
    const response = await fetch(base+options.path, {method:options.method, headers:options.header,
      ...(options.data === undefined ? {} : {body:JSON.stringify(options.data)})});
    return {statusCode:response.status, data:await response.json()};
  }}}, config);
  function call(path, data, token){
    return new Promise((resolve,reject)=>request({path:"/api"+path, method:data===undefined?"GET":"POST", data,
      header:{"Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{})},timeout:5000,
      success:resolve,fail:reject}));
  }
  async function api(path,data,token){
    const result = await call(path,data,token);
    assert.equal(result.statusCode,200,JSON.stringify(result.data));
    return result.data;
  }
  assert.equal((await api("/health")).mode,"wechat");
  const sessions=[];
  for(let i=0;i<count;i++) sessions.push(await api("/session",{code:`code-${i}`,name:`测试猫${i}`,avatar:i}));
  assert(sessions.every(s=>s.mode==="wechat"));
  let room = await api("/rooms",{noTurnTimer:true,nopeSeconds:10,allowNopeChain:true,includeImploding:true,includeReverse:true},sessions[0].token);
  const route = `/rooms/${room.code}`;
  for(const seat of sessions.slice(1)) room = await api("/rooms/join",{code:room.code},seat.token);
  assert.equal(room.players.length,count);
  // Production keeps Bot creation disabled even through the cloud transport.
  assert.equal((await call(route+"/bots",{count:1},sessions[0].token)).statusCode,403);
  for(let i=0;i<count;i++) room = await api(route+"/command",{type:"ready",ready:true,commandId:`ready-${i}`,revision:room.revision},sessions[i].token);
  room = await api(route+"/command",{type:"start",commandId:"start",revision:room.revision},sessions[0].token);
  assert.equal(room.game.rulesVersion,count===6?"ek-imploding-2023-online-v1":"ek-original-2025-online-v1");
  assert.equal(room.game.deckCount,count===6?28:35);
  const current = sessions.find(s=>s.player.id===room.game.current);
  assert(current);
  const before=room.revision;
  room = await api(route+"/command",{type:"draw",commandId:"draw",revision:room.revision,gameId:room.game.id},current.token);
  assert(room.revision>before);
  const closed = await api(route+"/command",{type:"closeRoom",commandId:"close",revision:room.revision},sessions[0].token);
  assert.equal(closed.status,"closed");
});
