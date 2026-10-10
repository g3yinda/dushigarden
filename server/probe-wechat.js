"use strict";
const {networkReason} = require("./wechat-login");

// Connectivity only: never load/send AppSecret, login code or player identity.
async function probeWechat({fetchImpl=fetch}={}) {
  const started=Date.now();
  try {
    const response=await fetchImpl("https://api.weixin.qq.com/sns/jscode2session",{
      signal:AbortSignal.timeout(8000),redirect:"error"});
    if(!response.ok) return {reachable:false,reason:"HTTP_ERROR",httpStatus:response.status,elapsedMs:Date.now()-started};
    const data=await response.json();
    if(!Number.isInteger(data?.errcode)) return {reachable:false,reason:"UNEXPECTED_RESPONSE",elapsedMs:Date.now()-started};
    // A missing-parameters WeChat error is expected, and proves HTTPS/JSON reachability.
    return {reachable:true,httpStatus:response.status,wechatErrcode:data.errcode,elapsedMs:Date.now()-started};
  } catch(error) {return {reachable:false,reason:networkReason(error),elapsedMs:Date.now()-started};}
}
if(require.main===module) probeWechat().then(result=>{
  console.log(JSON.stringify(result));
  process.exitCode=result.reachable?0:1;
});
module.exports={probeWechat};
