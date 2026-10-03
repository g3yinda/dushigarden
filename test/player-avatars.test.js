"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {RoomService} = require('../server/rooms');
const U = require('../miniprogram/lib/controller');
const wxAvatar = 'https://thirdwx.qlogo.cn/mmopen/vi_32/example/132';
const cmd = (s,id,r,type,more={}) => s.command(id,r.code,{commandId:Math.random().toString(36),revision:r.revision,type,...more});
test('头像目录恰好6猫4狗，保留原四猫并校验历史编号',()=>{
  assert.equal(U.avatars.length,10);
  assert.equal(U.avatars.filter(a=>a.kind==='cat').length,6);
  assert.equal(U.avatars.filter(a=>a.kind==='dog').length,4);
  assert.deepEqual(U.avatars.slice(0,4).map(a=>a.name),['奶油','桃桃','橘子','乌云']);
  assert.equal(U.avatarInfo({avatar:9}).id,9);
  assert.equal(U.avatarInfo({avatar:99}).id,0);
});
test('所有十个内置头像均能登录、修改且退出微信头像选择',()=>{
  const s = new RoomService();
  for(let avatar=0;avatar<10;avatar++) {
    const a=s.session({name:'测试',avatar});assert.equal(a.player.avatar,avatar);
    const next=(avatar+1)%10;assert.equal(s.profile(a.player.id,{avatar:next}).avatar,next);
  }
  const a=s.session({avatarUrl:wxAvatar});
  assert.equal(a.player.avatarUrl,wxAvatar);
  assert.equal(s.profile(a.player.id,{avatar:7,avatarUrl:''}).avatarUrl,'');
});
test('微信头像只允许官方HTTPS图片地址；拒绝伪造地址时不部分改名',()=>{
  const s=new RoomService(),a=s.session({name:'原名'});
  for(const avatarUrl of ['http://wx.qlogo.cn/mmopen/x/132','https://wx.qlogo.cn.evil.test/mmopen/x','https://wx.qlogo.cn@evil.test/mmopen/x','https://evil.test/x','file:///tmp/a','https://wx.qlogo.cn:8888/mmopen/x','https://wx.qlogo.cn/mmopen/x#frag',{},'https://wx.qlogo.cn/not-avatar']) {
    assert.throws(()=>s.profile(a.player.id,{name:'变更',avatarUrl}));
    assert.equal(s.players[a.player.id].name,'原名');
  }
  assert.equal(U.normalizeWechatAvatar('http://wx.qlogo.cn/mmopen/x/132'),'https://wx.qlogo.cn/mmopen/x/132');
  assert.equal(U.normalizeWechatAvatar('https://wx.qlogo.cn.evil.test/mmopen/x'),'');
});
test('微信头像从资料同步到等待席位、对局、选人及公开出牌角色',()=>{
  const s=new RoomService(),a=s.session({name:'小白'}),b=s.session({name:'狗狗',avatar:9});
  let r=s.create(a.player.id);r=s.join(b.player.id,r.code);
  s.profile(a.player.id,{avatarUrl:wxAvatar});r=s.view(a.player.id,r.code);
  assert.equal(r.players[0].avatarUrl,wxAvatar);
  r=cmd(s,a.player.id,r,'ready',{ready:true});r=cmd(s,b.player.id,r,'ready',{ready:true});r=cmd(s,a.player.id,r,'start');
  assert.equal(r.game.players[0].avatarUrl,wxAvatar);assert.equal(r.game.players[1].avatar,9);
  const v=U.derive(r,[]);assert.equal(v.players[0].avatarSource,wxAvatar);assert.equal(v.players[1].avatarSource,'pets-v1.jpg');
  const next=structuredClone(r);next.game.logs.push({id:100,cardEvent:{actor:a.player.id,target:b.player.id,kind:'play',cards:[{type:'favor'}]}});
  const e=U.motions(r,next)[0];
  assert.equal(e.actor.avatarSource,wxAvatar);assert.equal(e.target.avatar,9);
});
test('已开始的牌局不能更换头像，旧资料登录不会擦除已保存微信头像',()=>{
  const s=new RoomService(),a=s.session({name:'甲',avatar:9,avatarUrl:wxAvatar},'same-wechat');
  const again=s.session({name:'甲',avatar:9},'same-wechat');assert.equal(again.player.avatarUrl,wxAvatar);
  let r=s.create(a.player.id);const b=s.session({name:'乙'});r=s.join(b.player.id,r.code);
  r=cmd(s,a.player.id,r,'ready',{ready:true});r=cmd(s,b.player.id,r,'ready',{ready:true});r=cmd(s,a.player.id,r,'start');
  assert.throws(()=>s.profile(a.player.id,{avatar:3,avatarUrl:''}));assert.equal(s.players[a.player.id].avatarUrl,wxAvatar);
});
test('快照恢复保留微信头像与新狗狗编号，旧快照仍用原编号',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boomcat-avatars-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'state.json');const s=new RoomService({file});
  const a=s.session({avatar:9,avatarUrl:wxAvatar});const r=s.create(a.player.id);
  const restored=new RoomService({file});assert.equal(restored.authenticate(a.token).avatarUrl,wxAvatar);
  assert.equal(restored.view(a.player.id,r.code).players[0].avatar,9);
  assert.equal(restored.view(a.player.id,r.code).players[0].avatarUrl,wxAvatar);
});
