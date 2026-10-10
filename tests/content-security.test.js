"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createNicknameChecker}=require("../server/content-security");
const {normalizeNickname,migrateNicknames,reviewRecord}=require("../server/nickname-policy");
const {RoomService}=require("../server/rooms");
const response=data=>({ok:true,json:async()=>data});
const pass={errcode:0,result:{suggest:"pass",label:100},trace_id:"trace-pass"};
const cloudEnv={WX_CONTENT_SECURITY_MODE:"cloudrun"};

test("cloudrun调用官方HTTPS资料场景v2，昵称与真实身份绑定且不附加令牌",async()=>{
  const logs=[];
  const check=createNicknameChecker({env:cloudEnv,log:e=>logs.push(e),fetchImpl:async(url,options)=>{
    assert.equal(url,"https://api.weixin.qq.com/wxa/msg_sec_check");
    assert.equal(options.method,"POST"); assert.equal(options.redirect,"error");assert(options.signal);
    assert.deepEqual(JSON.parse(options.body),{version:2,scene:1,openid:"private-openid",content:"小白",nickname:"小白"});
    return response(pass);
  }});
  assert.deepEqual(await check("小白","private-openid"),{traceId:"trace-pass"});
  assert.equal(logs[0].outcome,"pass");
  assert(!JSON.stringify(logs).includes("小白"));assert(!JSON.stringify(logs).includes("private-openid"));
});
for(const data of [{errcode:0,result:{suggest:"risky"}},{errcode:0,result:{suggest:"review"}},{errcode:87014}])
  test(`风险或待人工复核均拒绝昵称 ${JSON.stringify(data)}`,async()=>{
    const check=createNicknameChecker({env:cloudEnv,log:()=>{},fetchImpl:async()=>response(data)});
    await assert.rejects(check("测试占位","openid"),e=>e.code==="NICKNAME_REJECTED"&&e.status===422);
  });
for(const data of [{errcode:0}, {result:{suggest:"pass"}}, {errcode:48001,errmsg:"private-info"},
  {errcode:45009}, {errcode:61010}, {errcode:0,result:{suggest:"unknown"}}, null])
  test(`错误、额度不足和不完整结果不能放行 ${JSON.stringify(data)}`,async()=>{
    const logs=[];
    const check=createNicknameChecker({env:cloudEnv,log:e=>logs.push(e),fetchImpl:async()=>response(data)});
    await assert.rejects(check("测试占位","openid"),e=>e.code==="NICKNAME_CHECK_UNAVAILABLE"&&e.status===503);
    assert(!JSON.stringify(logs).includes("private-info"));
  });
test("超时、TLS异常、JSON错误和HTTP失败不泄露上游细节且不放行",async()=>{
  const outcomes=[()=>{throw Object.assign(Error("secret/openid/nickname"),{cause:{code:"CERT_HAS_EXPIRED"}});},
    ()=>{throw Object.assign(Error("secret"),{name:"TimeoutError"});},
    ()=>({ok:false,status:500}),()=>({ok:true,json:async()=>{throw SyntaxError("secret");}})];
  for(const fetchImpl of outcomes){
    const logs=[];const check=createNicknameChecker({env:cloudEnv,fetchImpl,log:e=>logs.push(e)});
    await assert.rejects(check("昵称","openid"),e=>e.status===503&&!e.message.includes("secret"));
    assert(!JSON.stringify(logs).includes("secret"));
  }
});
test("stable_token合并并发请求、缓存到期续期，不使用强制全局刷新",async()=>{
  let now=0,gets=0,checks=0;
  const env={WX_APP_ID:"fixture-app",WX_APP_SECRET:"private-secret"};
  const check=createNicknameChecker({env,now:()=>now,log:()=>{},fetchImpl:async(url,options)=>{
    if(url.endsWith("stable_token")){
      gets++;assert.deepEqual(JSON.parse(options.body),{grant_type:"client_credential",appid:env.WX_APP_ID,secret:env.WX_APP_SECRET,force_refresh:false});
      return response({access_token:"private-token",expires_in:7200});
    }
    checks++;assert.equal(new URL(url).searchParams.get("access_token"),"private-token");return response(pass);
  }});
  await Promise.all([check("甲","a"),check("乙","b")]);assert.equal(gets,1);assert.equal(checks,2);
  now=7141000;await check("丙","c");assert.equal(gets,2);
});
test("失效token只重新获取一次并重试，持续无效最终阻断",async()=>{
  for(const recover of [true,false]){
    let gets=0,checks=0;
    const check=createNicknameChecker({env:{WX_APP_ID:"a",WX_APP_SECRET:"s"},log:()=>{},fetchImpl:async url=>{
      if(url.endsWith("stable_token"))return response({access_token:"token"+(++gets),expires_in:7200});
      checks++;return response(checks===2&&recover?pass:{errcode:40001});
    }});
    if(recover)await check("小白","a");else await assert.rejects(check("小白","a"),e=>e.status===503);
    assert.equal(gets,2);assert.equal(checks,2);
  }
});
test("缺配置、错误模式和缺OpenID不请求接口，不降级为放行",async()=>{
  for(const [env,openid] of [[{},"o"],[{WX_CONTENT_SECURITY_MODE:"off"},"o"],[cloudEnv,""]]){
    let calls=0;const check=createNicknameChecker({env,log:()=>{},fetchImpl:async()=>{calls++;return response(pass);}});
    await assert.rejects(check("小白",openid),e=>e.status===503);assert.equal(calls,0);
  }
});
test("昵称审核和实际保存使用相同的去空格、12字截断规则，非法类型或不可见控制符拒绝",()=>{
  assert.equal(normalizeNickname("  小白  "),"小白");assert.equal(normalizeNickname("123456789012345"),"123456789012");
  const name=normalizeNickname("12345678901 abc");
  const saved=new RoomService().session({name}).player.name;
  assert.equal(name,saved,"截断后末尾空格不能导致审核文本与保存文本不同");
  for(const value of [{},null,5,"隐\u200b藏","换\n行"])assert.throws(()=>normalizeNickname(value),e=>e.code==="NICKNAME_INVALID");
});
test("旧昵称迁移清理玩家、房间、对局和历史文本，保留手牌及事件且可重复执行",()=>{
  const service=new RoomService();
  const a=service.session({name:"旧昵称"},"a"),b=service.session({name:"已审昵称"},"b",reviewRecord("已审昵称",{traceId:"ok"}));
  let room=service.create(a.player.id);service.join(b.player.id,room.code);
  const r=service.rooms[room.code];
  r.game={players:r.players.map(p=>({...p,hand:[{id:"one",type:"skip"}]})),logs:[{id:1,text:"旧昵称 打出跳过",cardEvent:{type:"skip"}}]};
  migrateNicknames(service);
  assert.equal(service.players[a.player.id].name,"小猫");assert.equal(r.players[0].name,"小猫");
  assert.equal(r.game.players[0].name,"小猫");assert.equal(r.game.players[0].hand[0].id,"one");
  assert.equal(r.players[1].name,"已审昵称");assert(!JSON.stringify(service).includes("旧昵称"));
  assert.equal(r.game.logs[0].cardEvent.type,"skip");
  const before=JSON.stringify(service);migrateNicknames(service);assert.equal(JSON.stringify(service),before);
});
