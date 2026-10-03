"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const U = require("../web/controller");
const bridge = "../miniprogram/lib/game-runtime";
function harness() {
  const events = {}, frames = new Map(), storage = new Map();
  let sequence = 0;
  const wx = { canvas: { getContext: () => ({}) }, createCanvas() { return this.canvas; },
    getWindowInfo: () => ({windowWidth:390,windowHeight:844,pixelRatio:3,statusBarHeight:44,safeArea:{top:44,bottom:810}}),
    getLaunchOptionsSync: () => ({query:{room:"123456"}}),
    getStorageSync: k => storage.get(k), setStorageSync:(k,v)=>storage.set(k,v), removeStorageSync:k=>storage.delete(k),
    showKeyboard(o) { this.keyboard = o; }, hideKeyboard() {this.keyboardHidden=true;},
    showShareMenu() {}, showToast() {}, request() {throw Error("unit harness must not access network");},
  };
  for (const name of ["Show","Hide","WindowResize","TouchStart","TouchMove","TouchEnd","TouchCancel","KeyboardInput","KeyboardConfirm","KeyboardComplete","ShareAppMessage"])
    { wx["on"+name] = f => events[name]=f; wx["off"+name] = f => { if(events[name]===f) delete events[name]; }; }
  const context = {module:{exports:{}},require:n=>n.includes("controller")?U:{localMode:true},wx,
    setTimeout,clearTimeout,setInterval:()=>++sequence,clearInterval() {}};
  assert.doesNotThrow(()=>vm.runInNewContext(fs.readFileSync(require.resolve("../miniprogram/pages/home/home.js"),"utf8"),context),"业务层在无Page环境不应引用小程序全局Page");
  const definition = context.module.exports;
  assert.equal(typeof definition.onLoad,"function","业务定义必须能在没有Page的小游戏环境中加载");
  definition.restore = function() {this.restored=(this.restored||0)+1;};
  definition.poll = function() {this.polled=(this.polled||0)+1;};
  class Renderer {
    constructor(options) {Object.assign(this, options);this.renders=0;this.touches=[];}
    render() {this.renders++;} resize(info){this.info=info;} needsFrame(){return false;}
    touchStart(e){this.touches.push(e);} touchMove(e){this.touches.push(e);} touchEnd(e){this.touches.push(e);}
    destroy(){this.destroyed=true;}
  }
  assert(fs.existsSync(require("node:path").join(__dirname,bridge+".js")),"缺少小游戏生命周期桥");
  const runtime = require(bridge).createGameRuntime({wx,definition,Renderer,
    schedule:f=>{frames.set(++sequence,f);return sequence;},cancel:id=>frames.delete(id)});
  const flush=()=>{const current=[...frames.values()];frames.clear();current.forEach(f=>f(Date.now()));};
  return {runtime,wx,events,frames,flush,storage};
}
test("新AppID使用game入口和竖屏小游戏配置，不再要求缺失game.json",()=>{
  const project = require("../project.config.json");
  assert.equal(project.appid,"wxf7af6d01a9bbfdbd");assert.equal(project.compileType,"game");
  assert(fs.existsSync("miniprogram/game.js"));assert(fs.existsSync("miniprogram/game.json"));
  const game = require("../miniprogram/game.json");assert.equal(game.deviceOrientation,"portrait");
  assert(game.networkTimeout.request>=25000);
});
test("小游戏无需Page或App，创建DPR画布并接收房间邀请",()=>{
  const h=harness();assert.equal(h.wx.canvas.width,1170);assert.equal(h.wx.canvas.height,2532);
  assert.equal(h.runtime.page.invite,"123456");assert.equal(h.runtime.page.restored,1);
  h.flush();assert.equal(h.runtime.ui.renders,1);h.runtime.destroy();
});
test("嵌套setData与UI共享同一状态实例，同一帧合并重绘",()=>{
  const h=harness();h.flush();const page=h.runtime.page;
  page.setData({"v.ready":true,"selected[0]":"c1"});page.setData({"v.phaseTitle":"轮到你"});
  assert.equal(page.data.v.ready,true);assert.equal(page.data.selected[0],"c1");
  assert.equal(h.runtime.ui.page,page);assert.equal(h.frames.size,1);h.flush();assert.equal(h.runtime.ui.renders,2);
  h.runtime.destroy();
});
test("键盘输入昵称与房号有长度和数字限制，确认后关闭，不自动建房",()=>{
  const h=harness();h.runtime.openInput("name");assert.equal(h.wx.keyboard.maxLength,12);
  h.events.KeyboardInput({value:"很长的名字猫猫猫猫猫猫猫猫猫猫猫猫"});assert(h.runtime.page.data.name.length<=12);
  h.runtime.openInput("code");h.events.KeyboardConfirm({value:"12x345678"});
  assert.equal(h.runtime.page.data.code,"123456");assert.equal(h.wx.keyboardHidden,true);
  assert.equal(h.runtime.page.data.room,null);h.runtime.destroy();
});
test("背景暂停轮询和画布，恢复只开启一个时钟；触控取消不触发点击",()=>{
  const h=harness();h.flush();h.runtime.page.data.room={code:"123456"};
  let aborted=0;h.runtime.page.pollRequest={abort:()=>aborted++};
  h.events.Hide();assert.equal(h.runtime.page.visible,false);assert.equal(aborted,1);
  h.runtime.page.setData({connection:"后台"});assert.equal(h.frames.size,0);
  h.events.Show({query:{}});assert.equal(h.runtime.page.visible,true);assert.equal(h.runtime.page.polled,1);
  h.events.Show({query:{}});assert.equal(h.runtime.page.polled,1);
  h.events.TouchStart({touches:[{clientX:10,clientY:20}]});
  h.events.TouchCancel({changedTouches:[]});
  assert.equal(h.runtime.ui.touches.length,1);
  h.runtime.destroy();assert.equal(Object.keys(h.events).length,0);assert(h.runtime.ui.destroyed);
});
test("热启动邀请使用query，分享使用固定公开图片而非手牌截图",()=>{
  const h=harness();h.events.Hide();h.events.Show({query:{room:"654321"}});
  assert.equal(h.runtime.page.data.modal,"join");assert.equal(h.runtime.page.data.code,"654321");
  h.runtime.page.data.room={code:"123456"};const share=h.events.ShareAppMessage();
  assert.equal(share.query,"room=123456");assert.equal(share.path,undefined);
  assert.equal(share.imageUrl,"assets/share.png");h.runtime.destroy();
});
