"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createServer} = require("../server/index");
const {RoomService, ServiceError} = require("../server/rooms");

async function fixture(t, checkNickname) {
  const service = new RoomService();
  const server = createServer({service, mode:"wechat", exchangeCode:async code=>"openid-"+code, checkNickname});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const api = async (path, data, token) => {
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method:data===undefined?"GET":"POST", headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},
      ...(data===undefined?{}:{body:JSON.stringify(data)}),
    });
    return {status:res.status, data:await res.json()};
  };
  return {api, service};
}

test("生产昵称不通过时不能注册、持久化或取得会话，客户端审核字段无效", async t=>{
  let calls=0;
  const {api,service}=await fixture(t,async()=>{calls++;throw new ServiceError("昵称不合适，请换一个","NICKNAME_REJECTED",422);});
  const r=await api("/session",{code:"a",name:"风险测试占位",nicknameReview:{version:1,name:"风险测试占位"},openid:"fake"});
  assert.equal(r.status,422); assert.equal(calls,1);
  assert.equal(Object.keys(service.players).length,0); assert.equal(Object.keys(service.sessions).length,0);
});

test("改名审核绑定本人身份、审核前不变更房间，失败保留旧昵称", async t=>{
  const checks=[];
  const {api,service}=await fixture(t,async(name,openid)=>{
    checks.push({name,openid});
    if(name==="风险测试") throw new ServiceError("昵称不合适，请换一个","NICKNAME_REJECTED",422);
    return {traceId:"fixture-pass"};
  });
  const a=(await api("/session",{code:"a",name:"小白"})).data;
  const room=(await api("/rooms",{},a.token)).data;
  assert.equal((await api("/profile",{code:"b",name:"冒用"},a.token)).status,403);
  assert.equal((await api("/profile",{name:"风险测试"},a.token)).status,400);
  assert.equal((await api("/profile",{code:"a",name:"风险测试"},a.token)).status,422);
  assert.equal(service.players[a.player.id].name,"小白");
  assert.equal(service.rooms[room.code].players[0].name,"小白");
  const r=await api("/profile",{code:"a",name:"  桃桃  "},a.token);
  assert.equal(r.status,200);assert.equal(r.data.name,"桃桃");
  assert.deepEqual(checks.at(-1),{name:"桃桃",openid:"openid-a"});
  assert.equal(service.rooms[room.code].players[0].name,"桃桃");
  // An unchanged, previously checked name does not consume more daily quota.
  const before=checks.length;
  assert.equal((await api("/profile",{name:"桃桃",avatar:2},a.token)).status,200);
  assert.equal(checks.length,before);
});

test("等待审核完成之前不会发放会话",{timeout:2000},async t=>{
  let finish, entered;
  const started=new Promise(resolve=>entered=resolve);
  const {api,service}=await fixture(t,()=>{entered();return new Promise(resolve=>finish=resolve);});
  const result=api("/session",{code:"a",name:"小白"});
  await started;assert.equal(Object.keys(service.players).length,0);
  finish({traceId:"fixture"});assert.equal((await result).status,200);
});

test("审核服务故障保留已审核资料和房间；修改请求不能伪造审核记录",async t=>{
  let fail=false;
  const {api,service}=await fixture(t,async()=>{
    if(fail)throw new ServiceError("昵称审核暂时不可用，请稍后再试","NICKNAME_CHECK_UNAVAILABLE",503);
    return {traceId:"pass"};
  });
  const a=(await api("/session",{name:"原昵称",code:"a"})).data;
  const r=(await api("/rooms",{},a.token)).data;
  fail=true;
  assert.equal((await api("/profile",{code:"a",name:"新昵称",nicknameReview:{version:1,name:"新昵称"}},a.token)).status,503);
  assert.equal(service.players[a.player.id].name,"原昵称");
  assert.equal(service.rooms[r.code].players[0].name,"原昵称");
  assert.equal((await api("/session",{code:"a",name:"重新登录改名"})).status,503);
  assert.equal(Object.keys(service.sessions).length,1);
});

test("纯HTTP调用审核器的真实判定链路，超时和review不能被转换成放行",async t=>{
  const {createNicknameChecker}=require("../server/content-security");
  let suggest="review";
  const {api}=await fixture(t,createNicknameChecker({env:{WX_CONTENT_SECURITY_MODE:"cloudrun"},log:()=>{},
    fetchImpl:async()=>({ok:true,json:async()=>({errcode:0,result:{suggest},trace_id:"synthetic"})})}));
  assert.equal((await api("/session",{code:"a",name:"测试昵称"})).status,422);
  suggest="pass";
  assert.equal((await api("/session",{code:"a",name:"测试昵称"})).status,200);
});

test("并发通过的改名持久化的审核标记必须与最终昵称一致",async t=>{
  let release;
  const {api,service}=await fixture(t,async name=>name==="慢猫"?new Promise(r=>release=r):{traceId:"fast"});
  const a=(await api("/session",{code:"a",name:"原昵称"})).data;
  const slow=api("/profile",{code:"a",name:"慢猫"},a.token);
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal((await api("/profile",{code:"a",name:"快猫"},a.token)).status,200);
  release({traceId:"slow"});assert.equal((await slow).status,200);
  const p=service.players[a.player.id];assert.equal(p.name,"慢猫");assert.equal(p.nicknameReview.name,p.name);
});
