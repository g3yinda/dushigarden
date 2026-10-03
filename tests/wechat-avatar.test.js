"use strict";
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const U=require('../miniprogram/lib/controller');
function harness(){
  const created=[],notices=[],updates=[];
  const page={data:{modal:'profile',busy:false,name:'小白'},notice:s=>notices.push(s),useWechatAvatar:u=>updates.push(u)};
  const wx={createUserInfoButton(o){const button={options:o,onTap(f){this.tap=f},destroy(){this.dead=true}};created.push(button);return button}};
  const create=require('../miniprogram/lib/wechat-avatar').createWechatAvatarButton;
  const bridge=create({wx,page});return {bridge,page,wx,created,notices,updates};
}
const rect={x:30,y:300,w:260,h:48};
test('微信头像原生按钮只在资料窗口出现，重复渲染不反复创建',()=>{
  const h=harness();h.bridge.sync(rect);h.bridge.sync(rect);assert.equal(h.created.length,1);
  assert.equal(h.created[0].options.withCredentials,false);
  h.page.data.modal='';h.bridge.sync(rect);assert.equal(h.created[0].dead,true);
  h.created[0].tap({userInfo:{avatarUrl:'https://wx.qlogo.cn/mmopen/x/132'}});assert.equal(h.updates.length,0);
});
test('后台、改尺寸、销毁移除原生按钮；迟到授权不得覆盖动物选择',()=>{
  const h=harness();h.bridge.sync(rect);const old=h.created[0];
  h.bridge.sync({...rect,y:320});assert(old.dead);assert.equal(h.created.length,2);
  old.tap({userInfo:{avatarUrl:'https://wx.qlogo.cn/mmopen/x/132'}});assert.equal(h.updates.length,0);
  h.bridge.hide();assert(h.created[1].dead);h.bridge.sync(rect);h.bridge.destroy();assert(h.created[2].dead);
  h.bridge.sync(rect);assert.equal(h.created.length,3);
});
test('取消微信授权保留窗口与选项，成功才使用头像；不收集昵称性别',()=>{
  const h=harness();h.bridge.sync(rect);h.created[0].tap({errMsg:'getUserInfo:fail auth deny'});
  assert.equal(h.page.data.modal,'profile');assert.equal(h.updates.length,0);
  h.created[0].tap({userInfo:{avatarUrl:'https://wx.qlogo.cn/mmopen/x/132',nickName:'真实名字',gender:1}});
  assert.equal(h.updates.length,1);assert.equal(h.updates[0],'https://wx.qlogo.cn/mmopen/x/132');assert.equal(h.page.data.name,'小白');
});
test('头像本地选择与微信选择持久保存，损坏旧缓存回退且不崩溃',async()=>{
  const storage=new Map([['boom.avatar',999]]);let definition;
  const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),showToast(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/home/home.js'),'utf8'),{require:n=>n.includes('controller')?U:{localMode:true},wx,Page:p=>definition=p});
  const p=definition;p.setData=patch=>Object.assign(p.data,patch);p.restore=()=>{};p.onLoad({});assert.equal(p.data.avatar,0);
  p.useWechatAvatar('http://wx.qlogo.cn/mmopen/x/132');assert.equal(p.data.avatarUrl,'https://wx.qlogo.cn/mmopen/x/132');
  assert.equal(storage.get('boom.avatarUrl'),p.data.avatarUrl);
  await p.action({currentTarget:{dataset:{action:'avatar',id:9}}});assert.equal(p.data.avatar,9);assert.equal(p.data.avatarUrl,'');
  assert.equal(storage.get('boom.avatar'),9);assert.equal(storage.get('boom.avatarUrl'),'');
  const payloads=[];p.token='t';p.request=async(path,body)=>payloads.push({path,body});await p.session();assert.equal(payloads[0].body.avatar,9);assert.equal(payloads[0].body.avatarUrl,'');
});
