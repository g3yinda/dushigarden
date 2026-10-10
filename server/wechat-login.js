"use strict";
const {ServiceError} = require("./rooms");
const fs = require("node:fs");
const tls = require("node:tls");
const TLS_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE","UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT","SELF_SIGNED_CERT_IN_CHAIN","CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID","ERR_SSL_WRONG_VERSION_NUMBER"]);

// Never copy an upstream message/URL into logs: it can contain AppSecret or code.
function networkReason(error) {
  const code = error?.cause?.code || error?.code;
  if (error?.name === "TimeoutError" || error?.name === "AbortError" ||
      ["UND_ERR_CONNECT_TIMEOUT","ETIMEDOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT"].includes(code)) return "CONNECT_TIMEOUT";
  if (["ENOTFOUND","EAI_AGAIN"].includes(code)) return "DNS_FAILED";
  if (TLS_CODES.has(code)) return "TLS_FAILED";
  if (["ECONNREFUSED","ECONNRESET","EHOSTUNREACH","ENETUNREACH"].includes(code)) return "CONNECTION_FAILED";
  return "NETWORK_ERROR";
}

async function exchangeWechatCode(code, {fetchImpl=fetch,env=process.env,
  log=entry=>console.error("[wechat-login]",JSON.stringify(entry))}={}) {
  const started = Date.now();
  function record(phase,reason,fields={}) {
    // Logging failures must not alter authentication behavior.
    try {log({event:"wechat_login_failed",phase,reason,elapsedMs:Date.now()-started,...fields});} catch {}
  }
  if (!env.WX_APP_ID || !env.WX_APP_SECRET) {
    record("config","MISSING_CONFIG");
    throw new ServiceError("微信登录配置异常，请联系开发者","LOGIN_CONFIG",503);
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({appid:env.WX_APP_ID,secret:env.WX_APP_SECRET,
    js_code:code,grant_type:"authorization_code"}).toString();
  let response, data;
  try {
    response = await fetchImpl(url,{signal:AbortSignal.timeout(8000),redirect:"error"});
  } catch (error) {
    const reason=networkReason(error), fields={};
    if(reason==="TLS_FAILED") {
      // Only fixed categories and counts: never log certificate bytes, paths from env or error text.
      fields.tlsCode=error?.cause?.code || error?.code;
      try {
        fields.platformCACertPresent=fs.existsSync("/app/cert/certificate.crt");
        if(tls.getCACertificates) fields.extraCACount=tls.getCACertificates("extra").length;
      } catch {}
    }
    record("request",reason,fields);
    throw new ServiceError("微信登录暂时不可用，请稍后再试","LOGIN_UNAVAILABLE",503);
  }
  if (!response.ok) {
    record("response","HTTP_ERROR",Number.isInteger(response.status)?{httpStatus:response.status}:{});
    throw new ServiceError("微信登录暂时不可用，请稍后再试","LOGIN_UNAVAILABLE",503);
  }
  try {data=await response.json();} catch {
    record("response","INVALID_JSON");
    throw new ServiceError("微信登录暂时不可用，请稍后再试","LOGIN_UNAVAILABLE",503);
  }
  const errcode = Number.isInteger(data?.errcode) ? data.errcode : null;
  if ([40013,40125].includes(errcode)) {
    record("wechat","INVALID_CONFIG",{wechatErrcode:errcode});
    throw new ServiceError("微信登录配置异常，请联系开发者","LOGIN_CONFIG",503);
  }
  if (typeof data?.openid !== "string" || !data.openid || data.errcode) {
    record("wechat",errcode?"API_ERROR":"MISSING_OPENID",errcode===null?{}:{wechatErrcode:errcode});
    throw new ServiceError("微信登录已过期，请重试","LOGIN_FAILED",401);
  }
  return data.openid;
}
module.exports={exchangeWechatCode,networkReason};
