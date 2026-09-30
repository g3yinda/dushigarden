const test = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('../server/index');
const {RoomService} = require('../server/rooms');
const access='c'.repeat(64);
async function fixture(t,options={}) {
  const server=createServer({service:new RoomService(),mode:'preview',previewToken:access,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  return async (path,body,token='',debug=access)=>{
    const res=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(debug?{'X-Boomcat-Debug':debug}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:await res.json()};
  };
}
test('公网测试启动必须显式提供有效访问码，不能退回无认证本地模式',()=>{
  assert.throws(()=>createServer({mode:'preview'}),/访问码/);
  assert.throws(()=>createServer({mode:'preview',previewToken:'short'}),/访问码/);
  assert.throws(()=>createServer({mode:'unknown'}),/模式/);
});
test('代理回环地址也不能绕过公网访问码；API 会话和每个请求均校验',async t=>{
  const req=await fixture(t);
  assert.equal((await req('/api/session',{name:'甲'},'','')).status,403);
  assert.equal((await req('/api/session',{name:'甲'},'','wrong')).status,403);
  const a=await req('/api/session',{name:'甲'}); assert.equal(a.status,200);
  assert.equal((await req('/api/rooms',{},a.data.token,'')).status,403);
  assert.equal((await req('/api/rooms',{},a.data.token)).status,200);
  const publicHealth=await req('/api/health',null,'','');
  assert.equal(publicHealth.status,200); assert.equal(publicHealth.data.mode,'preview');
  assert.equal(JSON.stringify(publicHealth.data).includes(access),false);
  assert.equal((await req('/',null,'','')).status,403);
});
test('公网测试可添加5只 Bot 并开六人局；生产模式仍必须微信 code 登录',async t=>{
  const req=await fixture(t);
  const a=(await req('/api/session',{name:'云端验证'})).data;
  let r=(await req('/api/rooms',{noTurnTimer:true},a.token)).data;
  const move=async (type,extra={})=>{
    const result=await req('/api/rooms/'+r.code+(type==='addBots'?'/bots':'/command'),{type,...extra,revision:r.revision,gameId:r.game?.id,commandId:require('node:crypto').randomUUID()},a.token);
    assert.equal(result.status,200); return r=result.data;
  };
  await move('addBots',{count:5,respondNope:false});
  await move('ready',{ready:true}); await move('start');
  assert.equal(r.game.players.length,6); assert.equal(r.game.deckCount,28);
  const production=await fixture(t,{mode:'wechat',previewToken:'',exchangeCode:async()=>{throw Error('not expected');}});
  assert.equal((await production('/api/session',{name:'甲'})).status,400);
});
