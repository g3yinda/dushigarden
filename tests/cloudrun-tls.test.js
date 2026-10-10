"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("node:fs"), os=require("node:os"), path=require("node:path"), https=require("node:https");
const {spawn,spawnSync}=require("node:child_process");

test("容器启动CA配置使受信任HTTPS通过，并保持拒绝其他自签名证书",async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"boomcat-tls-"));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  function certificate(name){
    const key=path.join(temp,name+".key"), cert=path.join(temp,name+".crt");
    const result=spawnSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1",
      "-keyout",key,"-out",cert,"-subj","/CN=BoomCat local TLS fixture",
      "-addext","subjectAltName=IP:127.0.0.1"],{encoding:"utf8"});
    assert.equal(result.status,0,"本地TLS测试需要openssl生成隔离测试证书");
    return {key,cert};
  }
  const trusted=certificate("trusted"), other=certificate("untrusted");
  const server=https.createServer({key:fs.readFileSync(trusted.key),cert:fs.readFileSync(trusted.cert)},(_,res)=>res.end("ok"));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`https://127.0.0.1:${server.address().port}/`;
  const docker=fs.readFileSync(path.join(__dirname,"../Dockerfile"),"utf8");
  // Map the runtime certificate mount to an isolated local fixture; no production certs or keys.
  const configured=/^ENV NODE_EXTRA_CA_CERTS=\/app\/cert\/certificate\.crt$/m.test(docker);
  function request(extraCA){
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,["-e",
        'fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(r=>console.log(r.status)).catch(e=>console.log(e.cause?.code||e.name));',url],
        {env:{PATH:process.env.PATH,...(extraCA?{NODE_EXTRA_CA_CERTS:extraCA}:{})}});
      let stdout="";child.stdout.on("data",data=>stdout+=data);child.stderr.resume();
      child.on("error",reject);child.on("close",()=>resolve(stdout.trim()));
    });
  }
  assert.match(await request(null),/SELF_SIGNED|VERIFY|ISSUER/);
  assert.equal(await request(configured?trusted.cert:null),"200","Docker必须给Node启动进程配置平台CA文件，HTTPS才能建立信任");
  assert.match(await request(other.cert),/SELF_SIGNED|VERIFY|ISSUER/);
  assert.match(docker,/apk add --no-cache ca-certificates/);
  assert(!/NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/.test(docker));
});
