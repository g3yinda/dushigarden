"use strict";
const {ServiceError} = require("./rooms");
const {networkReason} = require("./wechat-login");

// Fixed official endpoints only. Neither tokens, OpenID, nickname nor upstream
// errmsg/detail/keyword may be copied into logs or client responses.
function createNicknameChecker({fetchImpl=fetch, env=process.env, now=Date.now,
  timeoutMs=8000, log=entry=>console.info("[nickname-security]",JSON.stringify(entry))}={}) {
  let cachedToken, tokenPending;
  const mode = env.WX_CONTENT_SECURITY_MODE || "access_token";
  function record(outcome, fields={}) {
    try {log({event:"nickname_security",outcome,...fields});} catch {}
  }
  function unavailable(reason, fields={}) {
    record("unavailable",{reason,...fields});
    return new ServiceError("昵称审核暂时不可用，请稍后再试","NICKNAME_CHECK_UNAVAILABLE",503);
  }
  async function post(url, body, signal) {
    try {
      const r=await fetchImpl(url,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body),signal,redirect:"error"});
      if (!r.ok) throw unavailable("HTTP_ERROR",Number.isInteger(r.status)?{httpStatus:r.status}:{});
      const data=await r.json();
      if (!data || typeof data!=="object" || Array.isArray(data)) throw unavailable("INVALID_RESPONSE");
      return data;
    } catch(e) {
      if(e instanceof ServiceError) throw e;
      throw unavailable(e instanceof SyntaxError?"INVALID_JSON":networkReason(e));
    }
  }
  async function token() {
    if(cachedToken && cachedToken.until > now()) return cachedToken.value;
    if(!tokenPending) {
      tokenPending=(async()=>{
        if(!env.WX_APP_ID || !env.WX_APP_SECRET) throw unavailable("MISSING_CONFIG");
        const data=await post("https://api.weixin.qq.com/cgi-bin/stable_token",{
          grant_type:"client_credential",appid:env.WX_APP_ID,secret:env.WX_APP_SECRET,force_refresh:false,
        },AbortSignal.timeout(timeoutMs));
        if(data.errcode || typeof data.access_token!=="string" || !data.access_token ||
          !Number.isFinite(data.expires_in) || data.expires_in<=0)
          throw unavailable("TOKEN_ERROR",Number.isInteger(data.errcode)?{wechatErrcode:data.errcode}:{});
        cachedToken={value:data.access_token,until:now()+Math.max(0,data.expires_in-60)*1000};
        return cachedToken.value;
      })().finally(()=>{tokenPending=null;});
    }
    return tokenPending;
  }
  return async function checkNickname(name, openid) {
    if(!["access_token","cloudrun"].includes(mode)) throw unavailable("INVALID_MODE");
    if(typeof openid!=="string" || !openid) throw unavailable("MISSING_OPENID");
    const signal=AbortSignal.timeout(timeoutMs);
    for(let attempt=0;attempt<2;attempt++) {
      const url=new URL("https://api.weixin.qq.com/wxa/msg_sec_check");
      let usedToken;
      if(mode==="access_token") {
        usedToken=await token();
        url.searchParams.set("access_token",usedToken);
      }
      const data=await post(url.toString(),{version:2,scene:1,openid,content:name,nickname:name},signal);
      // Refresh our local cache once. Do not force-refresh global WeChat tokens.
      if(mode==="access_token" && attempt===0 && [40001,40014,42001].includes(data.errcode)) {
        if(cachedToken?.value===usedToken) cachedToken=null;
        continue;
      }
      const traceId=typeof data.trace_id==="string" && /^[\w-]{1,128}$/.test(data.trace_id)?data.trace_id:"";
      const fields={...(traceId?{traceId}:{}),...(Number.isInteger(data.errcode)?{wechatErrcode:data.errcode}:{})};
      if(data.errcode===87014 || (data.errcode===0 && ["risky","review"].includes(data.result?.suggest))) {
        record("blocked",fields);
        throw new ServiceError("昵称未通过安全检查，请换一个昵称","NICKNAME_REJECTED",422);
      }
      if(data.errcode!==0 || data.result?.suggest!=="pass") throw unavailable("CHECK_ERROR",fields);
      record("pass",fields);
      return {traceId};
    }
    throw unavailable("TOKEN_ERROR");
  };
}
module.exports={createNicknameChecker};
