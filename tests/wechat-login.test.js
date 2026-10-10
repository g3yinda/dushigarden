"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {exchangeWechatCode} = require("../server/wechat-login");
const secret = "synthetic-secret-that-must-not-be-logged";
const code = "synthetic-code-that-must-not-be-logged";
function fixture(fetchImpl) {
  const logs=[];
  return {logs, run:()=>exchangeWechatCode(code,{fetchImpl,env:{WX_APP_ID:"wxf7af6d01a9bbfdbd",WX_APP_SECRET:secret},log:entry=>logs.push(entry)})};
}
test("微信登录成功只返回openid，不输出身份、会话密钥或请求凭据", async()=>{
  const f=fixture(async(url,options)=>{
    assert.equal(url.protocol,"https:");
    assert.equal(url.hostname,"api.weixin.qq.com");
    assert.equal(url.searchParams.get("secret"),secret);
    assert.equal(options.redirect,"error");
    return {ok:true,status:200,json:async()=>({openid:"private-openid",session_key:"private-session-key"})};
  });
  assert.equal(await f.run(),"private-openid");
  assert.equal(f.logs.length,0);
});
for (const [cause,reason] of [["UND_ERR_CONNECT_TIMEOUT","CONNECT_TIMEOUT"],["EAI_AGAIN","DNS_FAILED"],["UNABLE_TO_VERIFY_LEAF_SIGNATURE","TLS_FAILED"],["ECONNREFUSED","CONNECTION_FAILED"]])
  test(`微信登录安全诊断${reason}，不能记录错误原文或URL中的秘密`,async()=>{
    const f=fixture(async()=>{throw {message:`failed ${secret} ${code}`,cause:{code:cause,message:secret}};});
    await assert.rejects(f.run(),error=>error.code==="LOGIN_UNAVAILABLE"&&error.status===503);
    assert.equal(f.logs.length,1);
    assert.equal(f.logs[0].reason,reason);
    assert.equal(f.logs[0].phase,"request");
    if(reason==="TLS_FAILED") {
      assert.equal(f.logs[0].tlsCode,cause);
      assert.equal(typeof f.logs[0].platformCACertPresent,"boolean");
      assert(Number.isInteger(f.logs[0].extraCACount));
    }
    assert(!JSON.stringify(f.logs).includes(secret));
    assert(!JSON.stringify(f.logs).includes(code));
  });
test("微信接口HTTP失败与非JSON响应分别记录，用户错误不含上游原文",async()=>{
  const http=fixture(async()=>({ok:false,status:502}));
  await assert.rejects(http.run(),error=>error.code==="LOGIN_UNAVAILABLE");
  assert.equal(http.logs[0].reason,"HTTP_ERROR");
  assert.equal(http.logs[0].httpStatus,502);
  const json=fixture(async()=>({ok:true,status:200,json:async()=>{throw Error(secret);}}));
  await assert.rejects(json.run(),error=>error.code==="LOGIN_UNAVAILABLE");
  assert.equal(json.logs[0].reason,"INVALID_JSON");
  assert(!JSON.stringify(json.logs).includes(secret));
});
test("未知错误码不进入日志，避免错误字段携带秘密",async()=>{
  const f=fixture(async()=>{throw {cause:{code:secret}};});
  await assert.rejects(f.run(),error=>error.code==="LOGIN_UNAVAILABLE");
  assert.equal(f.logs[0].reason,"NETWORK_ERROR");
  assert(!JSON.stringify(f.logs).includes(secret));
  assert.equal(f.logs[0].tlsCode,undefined);
});
test("微信返回密钥错误与code错误准确区分，不存原始errmsg或session_key",async()=>{
  for(const errcode of [40125,40013,40029]){
    const f=fixture(async()=>({ok:true,status:200,json:async()=>({errcode,errmsg:secret,session_key:secret})}));
    await assert.rejects(f.run(),error=>error.code===(errcode===40029?"LOGIN_FAILED":"LOGIN_CONFIG"));
    assert.equal(f.logs[0].wechatErrcode,errcode);
    assert(!JSON.stringify(f.logs).includes(secret));
  }
});
test("空对象或null成功响应不能引发额外异常或创建身份；缺配置不请求上游",async()=>{
  for(const data of [null,{},[]]){
    const f=fixture(async()=>({ok:true,status:200,json:async()=>data}));
    await assert.rejects(f.run(),error=>error.code==="LOGIN_FAILED");
    assert.equal(f.logs[0].reason,"MISSING_OPENID");
  }
  await assert.rejects(exchangeWechatCode(code,{env:{},fetchImpl:()=>{throw Error("不得请求");},log(){}}),error=>error.code==="LOGIN_CONFIG");
});
