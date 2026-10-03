"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const U = require("../web/controller");
const {createGameRuntime} = require("../miniprogram/lib/game-runtime");
const {createServer} = require("../server/index");
const {RoomService} = require("../server/rooms");
const {chooseAction} = require("../server/bots");

for (const n of [2,3,4,5,6]) test(`小游戏业务实例通过真实HTTP完成${n}人建房、Bot、开局、抽牌、关房`, async t=>{
  const service = new RoomService({rng:()=>0.5});
  const server = createServer({service});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const storage=new Map(), notices=[];
  const wx={createCanvas:()=>({getContext:()=>({})}),getWindowInfo:()=>({windowWidth:390,windowHeight:844,pixelRatio:1}),
    getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),
    showToast:option=>notices.push(option.title),
    request(options) {
      const control=new AbortController();
      fetch(options.url,{method:options.method,headers:options.header,
        ...(options.data!==undefined?{body:JSON.stringify(options.data)}:{}),signal:control.signal})
        .then(async res=>options.success({statusCode:res.status,data:await res.json()}))
        .catch(error=>options.fail({errMsg:String(error)}));
      return {abort:()=>control.abort()};
    }};
  const context={module:{exports:{}},wx,require:path=>path.includes("controller")?U:{localMode:true,apiBase:base},setTimeout,clearTimeout,setInterval,clearInterval};
  vm.runInNewContext(fs.readFileSync(require.resolve("../miniprogram/pages/home/home.js"),"utf8"),context);
  context.module.exports.poll=()=>{}; // Explicit commands drive this isolated HTTP fixture.
  class Renderer{render(){}resize(){}needsFrame(){return false;}destroy(){}}
  const runtime=createGameRuntime({wx,definition:context.module.exports,Renderer});
  t.after(async()=>{runtime.destroy();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  const page=runtime.page;
  const action=(a,data={})=>page.action({currentTarget:{dataset:{action:a,...data}}});
  page.input({currentTarget:{dataset:{field:"name"}},detail:{value:"小游戏验收猫"}});
  await action("create");page.roomSetting({detail:{value:true}});await action("create-submit");
  assert(page.data.room);assert.equal(page.data.modal,"");
  await action("bots");page.chooseBotCount({detail:{value:n-2}});await action("bots-submit");
  assert.equal(page.data.room.players.length,n);
  await action("ready");assert(page.data.v.canStart);await action("start");
  assert.equal(page.data.room.game.hand.length,8);assert.equal(page.data.handExpanded,false);
  assert.equal(page.data.room.game.rulesVersion,n===6?"ek-imploding-2023-online-v1":"ek-original-2025-online-v1");
  assert.equal(page.data.room.game.deckCount,{2:35,3:29,4:23,5:16,6:28}[n]);
  assert(page.data.room.game.players.every(p=>!p.hand));
  // Advance only bot-owned turns through normal service commands until our turn.
  for(let i=0;!page.data.v.canDraw&&i<120;i++){
    const room=service.rooms[page.data.room.code];
    const seat=room.players.find(p=>p.id===room.game.current);
    if(!seat?.isBot)break;
    const view=service.view(seat.id,room.code);
    const intent=chooseAction(view,{rng:()=>0.99,played:3,respondNope:false});
    if(!intent)break;
    service.command(seat.id,room.code,{...intent,commandId:`mini-${n}-${i}`,revision:view.revision,gameId:view.game.id});
    await page.refresh();
  }
  assert(page.data.v.canDraw,"正常Bot行动后应轮到真实小游戏实例抽牌");
  const rev=page.data.room.revision;await action("draw");assert(page.data.room.revision>rev);
  await action("leave");assert.equal(page.data.modal,"leave");
  await action("close-room");assert.equal(page.data.modal,"close-room");await action("close-room-submit");
  assert.equal(page.data.room,null);assert.equal(page.data.modal,"");
  assert(!notices.some(s=>/失败|出错|无效/.test(s)),notices.join(" / "));
});
