const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const U = require('../web/controller');
const EXPANSION = ['imploding', 'targetAttack', 'reverse', 'bottom', 'alterFuture', 'feral'];
function room(types = [], phase = 'action') {
  const players = [{id:'a',name:'甲',alive:true,count:5}, {id:'b',name:'乙',alive:true,count:0}, {id:'c',name:'丙',alive:false,count:0}];
  return {code:'123456',status:'playing',revision:1,serverNow:Date.now(),me:'a',hostId:'a',options:{noTurnTimer:true},players,
    game:{id:'g',rulesVersion:'ek-imploding-2023-online-v1',phase,current:'a',direction:-1,remaining:1,players,deckCount:4,hand:types.map((type,i)=>({id:String(i),type})),discard:[]}};
}
function native() {
  let page;
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/home/home.js'),'utf8'), {
    require:name=>name.includes('controller')?U:{localMode:true},Page:p=>page=p,wx:{},setTimeout:()=>1,clearTimeout(){},
  });
  page.setData=update=>require("./native-data").applyData(page.data,update); page.notice=()=>{};
  return {state:page.data,accept:r=>page.accept(r),click:(action,data={})=>page.action({currentTarget:{dataset:{action,...data}}}),page};
}
async function browser() {
  const handlers={},nodes={'#app':{innerHTML:''},'#toast':{style:{}}};
  const context=vm.createContext({BoomUI:U,sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},document:{body:{classList:{toggle(){}}},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener:(e,h)=>handlers[e]=h},fetch:async()=>({ok:true,json:async()=>({ok:true,mode:'local'})}),location:{search:'',origin:'http://localhost'},URLSearchParams,setInterval(){},setTimeout:()=>1,clearTimeout(){},crypto:require('node:crypto')});
  vm.runInContext(fs.readFileSync(require.resolve('../web/app.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {state:vm.runInContext('S',context),context,nodes,accept:r=>{context.nextRoom=r;vm.runInContext('accept(nextRoom)',context);},click:(action,data={})=>handlers.click({target:{closest:()=>({dataset:{action,...data}})}})};
}
test('两端控制器一致，六张扩展卡都有真实名称、作用与可辨识符号',()=>{
  assert.equal(fs.readFileSync(require.resolve('../web/controller'),'utf8'),fs.readFileSync(require.resolve('../miniprogram/lib/controller'),'utf8'));
  for(const type of EXPANSION){const c=U.card({id:type,type});assert.notEqual(c.name,type);assert(c.symbol);assert(!c.short.includes('同名组合')||type==='feral');assert(c.description.length>10);}
});
test('定向攻击允许存活的自己和零手牌玩家，原索要和对子仍禁止',()=>{
  for(const type of ['targetAttack','reverse','bottom','alterFuture']) assert.equal(U.selection(room([type]),['0']).valid,true);
  const target=U.derive(room(['targetAttack']),['0']);assert(target.selection.needsTarget);assert.deepEqual(target.targets.map(p=>p.id),['a','b']);
  assert.equal(U.selection(room(['favor']),['0']).valid,false);
  assert.equal(U.selection(room(['cat1','cat1']),['0','1']).valid,false);
});
test('野猫只代替单一种普通猫或全野猫，不能混合功能牌或单张打出',()=>{
  for(const types of [['feral','cat1'],['feral','cat2','cat2'],['feral','feral','feral']]){
    const r=room(types);r.game.players[1].count=1;assert.equal(U.selection(r,types.map((_,i)=>String(i))).valid,true);
  }
  for(const types of [['feral'],['feral','attack'],['feral','cat1','cat2'],['imploding','imploding'],['bomb','bomb']]) assert.equal(U.selection(room(types),types.map((_,i)=>String(i))).valid,false);
});
test('点名列表按规则版本隔离扩展且永不包含危险牌',()=>{
  const r=room(['cat1','cat1','cat1']);let options=U.derive(r,['0','1','2']).namedOptions;assert(options.some(c=>c.value==='feral'));assert(options.some(c=>c.value==='bottom'));assert(!options.some(c=>['bomb','imploding'].includes(c.value)));
  r.game.rulesVersion='ek-original-2025-online-v1';options=U.derive(r,[]).namedOptions;assert(!options.some(c=>EXPANSION.includes(c.value)));
});
test('只显示公开翻面内爆边界，区分首次内爆插回且保留方向',()=>{
  const r=room([], 'insert');r.game.bomb={id:'i',type:'imploding',faceUp:true};r.game.deckTop={id:'i2',type:'imploding',faceUp:true};r.game.deckBottom={id:'secret',type:'bomb'};
  const v=U.derive(r,[]);assert.match(v.insertTitle,/内爆/);assert.match(v.insertHint,/不能拆弹/);assert.match(v.directionText,/逆时针/);assert(v.deckTop);assert.equal(v.deckBottom,null);
  assert.equal(U.motion(room(),r).card.type,'imploding');
});
for(const client of ['native','browser']) test(`${client} 私密排序由上下按钮调整，同步不重置，明确确认才提交完整排列`,async()=>{
  const h=client==='native'?native():await browser();const r=room(['alterFuture'],'alterFuture');r.game.future=[{id:'f1',type:'bomb'},{id:'f2',type:'reverse'},{id:'f3',type:'skip'}];h.accept(r);
  assert.equal(h.state.handExpanded,false);assert.deepEqual(Array.from(h.state.futureState.order),['f1','f2','f3']);
  let submitted;
  if(client==='native') h.page.command=async(type,data)=>submitted={type,...data};
  else h.context.fetch=async(_,o)=>{submitted=JSON.parse(o.body);const next=structuredClone(r);next.game.phase='action';delete next.game.future;return {ok:true,json:async()=>next};};
  await h.click('future-down',{id:'f1'});assert.equal(submitted,undefined);assert.deepEqual(Array.from(h.state.futureState.order),['f2','f1','f3']);
  const next=structuredClone(r);next.revision++;h.accept(next);assert.deepEqual(Array.from(h.state.futureState.order),['f2','f1','f3']);
  await h.click('future-up',{id:'f3'});assert.deepEqual(Array.from(h.state.futureState.order),['f2','f3','f1']);
  await h.click('orderFuture');assert.equal(submitted.type,'orderFuture');assert.deepEqual(Array.from(submitted.order),['f2','f3','f1']);
  const spectator=structuredClone(r);spectator.me='b';spectator.revision=20;h.accept(spectator);assert.equal(h.state.futureState,null);
});
for(const client of ['native','browser']) test(`${client} 基础局声明列表及目标选择在同步中保留，新阶段重置`,async()=>{
  const h=client==='native'?native():await browser();const r=room(['targetAttack']);h.accept(r);await h.click('card',{id:'0'});await h.click('prepare');await h.click('target',{id:'a'});
  const next=structuredClone(r);next.revision++;h.accept(next);assert.equal(h.state.target,'a');assert.equal(h.state.modal,'play');
  const nope=structuredClone(next);nope.game.phase='nope';nope.game.pending={type:'targetAttack',actor:'a',nopeCount:0};h.accept(nope);assert(!h.state.modal);assert.equal(h.state.target,'');
  next.game.phase='action';next.game.rulesVersion='ek-original-2025-online-v1';h.accept(next);
  if(client==='native') assert(!h.state.namedOptions.some(c=>EXPANSION.includes(c.value)));
  else {h.state.selected=['0'];h.state.modal='play';h.context.nextRoom=next;vm.runInContext('render()',h.context);assert.doesNotMatch(h.nodes['#app'].innerHTML,/<option value="(?:feral|imploding)"/);}
});
test('browser 私密重排与危险牌提示真实渲染，方向说明精简，旁观者不展示私密牌',async()=>{
 const h=await browser();const r=room([],'alterFuture');r.game.future=[{id:'secret',type:'bomb'}];r.game.deckTop={id:'i',type:'imploding',faceUp:true};h.accept(r);
 assert.match(h.nodes['#app'].innerHTML,/确认顺序/);assert.match(h.nodes['#app'].innerHTML,/牌顶.*内爆猫/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/table-direction|逆时针/);assert.match(h.nodes['#app'].innerHTML,/data-action="future-down"/);
 r.me='b';h.accept(r);assert.doesNotMatch(h.nodes['#app'].innerHTML,/确认顺序|data-action="future-down"/);
});

test('公开内爆动效只排队一次，首次翻面与再次致命有明确文字',()=>{
 const before=room(); before.game.logs=[];
 const first=room([], 'insert');first.game.bomb={id:'i',type:'imploding',faceUp:true};first.game.logs=[{id:1,cardEvent:{kind:'implode',actor:'a',cards:[{id:'i',type:'imploding',faceUp:false}]}}];
 const effects=U.motions(before,first);assert.equal(effects.length,1);assert.match(effects[0].title,/首次.*翻面/);assert.equal(effects[0].card.faceUp,true);assert.equal(effects[0].card.stateLabel,'已翻面');assert.equal(effects[0].card.short,'已翻面：抽到立即出局');
 const second=room();second.game.logs=[{id:1,cardEvent:{kind:'implode',actor:'b',cards:[{id:'i',type:'imploding',faceUp:true}]}}];assert.match(U.motions(before,second)[0].title,/乙.*出局/);
});
test('六张扩展牌使用新原创图集的独立格子，顶部与底部各自居中裁切',()=>{
 const arts=EXPANSION.map(type=>U.card({type}));
 assert(arts.every(c=>c.source==='expansion.jpg'));
 assert.equal(new Set(arts.map(c=>c.art)).size,6);
 assert.match(arts[0].art,/translateY\(-25%\)/);
 assert.match(arts[3].art,/translateY\(-75%\)/);
});
for(const client of ['native','browser']) test(`${client} 离开对局清除本地私密排序，旧按钮不能提交`,async()=>{
 const h=client==='native'?native():await browser();const r=room([], 'alterFuture');r.game.future=[{id:'f',type:'skip'}];h.accept(r);
 if(client==='native') h.page.request=async()=>null;else h.context.fetch=async()=>({ok:true,json:async()=>null});
 await h.click('leave-submit');assert.equal(h.state.futureState,null);assert.equal(h.state.room,null);
 let calls=0;if(client==='native') h.page.command=async()=>calls++;else h.context.fetch=async()=>{calls++;throw Error('unexpected');};
 await h.click('orderFuture');assert.equal(calls,0);
});
test('私密未来内爆猫明确区分已翻面、未翻面及旧快照缺省状态',()=>{
 const r=room([], 'alterFuture');r.game.future=[{id:'down',type:'imploding',faceUp:false},{id:'up',type:'imploding',faceUp:true},{id:'old',type:'imploding'}];
 const cards=U.futureOrder(r).cards;
 assert.equal(cards[0].short,'未翻面：抽到翻面放回');assert.equal(cards[1].short,'已翻面：抽到立即出局');assert.equal(cards[2].short,cards[0].short);
 assert.equal(cards[0].stateLabel,'未翻面');assert.equal(cards[1].stateLabel,'已翻面');assert.match(cards[0].description,/当前未翻面/);assert.match(cards[1].description,/当前已翻面/);
 r.game.phase='future';assert.equal(U.derive(r,[]).future[1].stateLabel,'已翻面');
});
test('规则模式标记区分新扩展、基础版、历史六人局及等待房间人数',()=>{
 const r=room();assert.equal(U.derive(r,[]).rulesLabel,'完整内爆猫扩展');
 r.game.rulesVersion='ek-original-2025-online-v1';assert.equal(U.derive(r,[]).rulesLabel,'基础版');
 r.game.rulesVersion='ek-original-2025-friends-6p-v1';assert.equal(U.derive(r,[]).rulesLabel,'六人朋友规则（旧局）');
 r.game=null;r.status='waiting';assert.equal(U.derive(r,[]).rulesLabel,'基础版');
 r.players.push({id:'d'},{id:'e'},{id:'f'});assert.equal(U.derive(r,[]).rulesLabel,'完整内爆猫扩展');
});
test('浏览器私密未来显示内爆状态，规则模式只在准备页显示',async()=>{
 const h=await browser();const r=room([], 'alterFuture');r.game.future=[{id:'up',type:'imploding',faceUp:true},{id:'down',type:'imploding',faceUp:false}];h.accept(r);
 assert.match(h.nodes['#app'].innerHTML,/已翻面：抽到立即出局/);assert.match(h.nodes['#app'].innerHTML,/未翻面：抽到翻面放回/);assert.doesNotMatch(h.nodes['#app'].innerHTML,/table-brand|BOOMCAT · 完整内爆猫扩展/);
 const waiting=structuredClone(r);waiting.revision++;waiting.game=null;waiting.status='waiting';h.accept(waiting);assert.match(h.nodes['#app'].innerHTML,/room-mode.*基础版/);
});
test('大厅插画人数由真实组件显示2–6，两端解释基础版与六人扩展',async()=>{
 const h=await browser();assert.match(h.nodes['#app'].innerHTML,/class="hero-count">2–6 人/);assert.match(h.nodes['#app'].innerHTML,/2–5 人基础版 · 6 人完整内爆猫扩展/);
 const nativeSource=fs.readFileSync(require.resolve('../miniprogram/pages/home/home.wxml'),'utf8');assert.match(nativeSource,/class="hero-count">2–6 人/);assert.match(nativeSource,/2–5 人基础版 · 6 人完整内爆猫扩展/);
});
