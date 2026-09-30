'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const E=require('../server/engine'),{CARDS}=require('../shared/cards');
const ps=Array.from({length:6},(_,i)=>({id:'p'+i,name:'猫'+i}));
const extra=['imploding','targetAttack','reverse','bottom','alterFuture','feral'];
function game(hands=[[]],deck=['skip','bomb','bomb','bomb','bomb','imploding'],options={}) {
  const g=E.createGame(ps,{now:1000,rng:()=>.4,id:'exp',...options}); let i=0;
  const c=t=>typeof t==='string'?{type:t,id:'c'+i++}:{...t,id:'c'+i++};
  g.players.forEach((p,j)=>p.hand=(hands[j]||[]).map(c));g.deck=deck.map(c);g.discard=[];g.exploded=[];g.current='p0';g.totalCards=i;return g;
}
const act=(g,type,extra={},id='p0')=>E.command(g,id,{type,...extra},{now:1001,rng:()=>.4});
const play=(g,ids=['c0'],more={})=>act(g,'play',{cards:ids,...more});
const settle=g=>E.tick(g,{now:g.deadline,rng:()=>.4});
function invariant(g){E.assertInvariant(g);return g;}
test('完整六人76张：20张扩展准确分布，28张牌堆，4炸弹+1内爆，每人8张',()=>{
 const g=E.createGame(ps,{now:1000,rng:()=>.4});
 assert.equal(g.rulesVersion,'ek-imploding-2023-online-v1');assert.equal(g.totalCards,76);assert.equal(g.deck.length,28);
 const all=[...g.deck,...g.players.flatMap(p=>p.hand)];
 for(const [t,n] of Object.entries({imploding:1,targetAttack:3,reverse:4,bottom:4,alterFuture:4,feral:4,bomb:4,defuse:6})) assert.equal(all.filter(c=>c.type===t).length,n,t);
 assert(g.players.every(p=>p.hand.length===8&&p.hand.some(c=>c.type==='defuse')));invariant(g);
});
test('2–5人基础版牌库、规则版本完全保持且没有扩展牌',()=>{
 for(const n of [2,3,4,5]){const g=E.createGame(ps.slice(0,n));assert.equal(g.deck.length,{2:35,3:29,4:23,5:16}[n]);assert.equal(g.rulesVersion,'ek-original-2025-online-v1');assert(![...g.deck,...g.players.flatMap(p=>p.hand)].some(c=>extra.includes(c.type)));invariant(g);}
});
test('内爆首抽直接翻面秘密插回，不消耗拆弹；再次抽到直接淘汰',()=>{
 let g=game([['defuse'],['defuse']],['imploding','skip','bomb','bomb','bomb','bomb']);
 g=invariant(act(g,'draw'));assert.equal(g.phase,'insert');assert.equal(g.bomb.faceUp,true);assert.equal(g.players[0].hand.length,1);
 assert.throws(()=>act(g,'defuse'));assert.throws(()=>act(g,'nope',{cardId:'c0'}));
 g=invariant(act(g,'insert',{position:1}));assert.equal(g.current,'p1');assert.equal(g.deck[0].faceUp,true);
 g=invariant(act(g,'draw',{},'p1'));assert.equal(g.players[1].alive,false);assert.equal(g.players[1].hand[0].type,'defuse');assert.equal(g.current,'p2');assert.equal(g.exploded[0].type,'imploding');
});
test('内爆秘密位置不泄露，只有翻面牌顶/牌底公开；洗牌保留翻面',()=>{
 let g=game([['shuffle']],['imploding','skip','bomb','bomb','bomb','bomb']);g=act(g,'draw');g=act(g,'insert',{position:3});
 let v=E.project(g,'p2');assert.equal(v.deckTop,null);assert.equal(v.deckBottom,null);assert(!JSON.stringify(v).includes('第 3 张'));assert(!('deck'in v));
 const c=g.deck.splice(2,1)[0];g.deck.unshift(c);v=E.project(g,'p2');assert.equal(v.deckTop.type,'imploding');assert.equal(v.deckTop.faceUp,true);
 g.current='p0';g=settle(play(g));assert(g.deck.find(c=>c.type==='imploding').faceUp);invariant(g);
 g.deck.push(g.deck.splice(g.deck.findIndex(c=>c.type==='imploding'),1)[0]);assert.equal(E.project(g,'p2').deckBottom.type,'imploding');
});
test('普通攻击按反转方向走，反转受攻击仅减1，二人存活按跳过',()=>{
 let g=game([['reverse','attack']]);g.remaining=2;g.attacked=true;g=settle(play(g));assert.equal(g.direction,-1);assert.equal(g.current,'p0');assert.equal(g.remaining,1);
 g=settle(play(g,['c1']));assert.equal(g.current,'p5');assert.equal(g.remaining,3);
 g=game([['reverse']]);g.players.slice(2).forEach(p=>p.alive=false);g=settle(play(g));assert.equal(g.current,'p1');assert.equal(g.direction,1);
});
test('定向攻击允许自己和空手对手，转移剩余负债并加2，可否定',()=>{
 let g=game([['targetAttack','targetAttack']]);g.remaining=3;g.attacked=true;
 g=settle(play(g,['c0'],{target:'p0'}));assert.equal(g.current,'p0');assert.equal(g.remaining,5);
 g=settle(play(g,['c1'],{target:'p3'}));assert.equal(g.current,'p3');assert.equal(g.remaining,7);
 g=game([['targetAttack'],['nope']]);g=play(g,['c0'],{target:'p2'});g=act(g,'nope',{cardId:'c1'},'p1');g=settle(g);assert.equal(g.current,'p0');assert.equal(g.remaining,1);
});
test('反转被否定不改变方向或回合',()=>{
 let g=game([['reverse'],['nope']]);g=play(g);g=act(g,'nope',{cardId:'c1'},'p1');g=settle(g);assert.equal(g.direction,1);assert.equal(g.current,'p0');
});
test('牌底抽牌通过否定窗口后抽底并只结束1回合；危险牌共用流程',()=>{
 let g=game([['bottom']],['skip','bomb','bomb','bomb','bomb','imploding']);g.remaining=2;g.attacked=true;
 g=settle(play(g));assert.equal(g.phase,'insert');assert.equal(g.bomb.type,'imploding');g=invariant(act(g,'insert',{position:2}));assert.equal(g.remaining,1);assert.equal(g.current,'p0');
 g=game([['bottom','defuse']],['imploding','skip','bomb','bomb','bomb','bomb']);g=settle(play(g));assert.equal(g.phase,'defuse');assert.equal(g.bomb.type,'bomb');
 g=game([['bottom']],['imploding','bomb','bomb','bomb','bomb','skip']);g=settle(play(g));assert.equal(g.players[0].hand[0].type,'skip');assert.equal(g.current,'p1');invariant(g);
});
test('被否定的牌底抽牌不抽牌、不结束回合',()=>{
 let g=game([['bottom'],['nope']]);const before=g.deck;g=play(g);g=act(g,'nope',{cardId:'c1'},'p1');g=settle(g);assert.deepEqual(g.deck,before);assert.equal(g.current,'p0');
});
test('改变未来私密重排、完整排列校验、返回行动保留预算和翻面状态',()=>{
 let g=game([['alterFuture']],['skip',{type:'imploding',faceUp:true},'bomb','bomb','bomb','bomb']);
 g=settle(play(g));assert.equal(g.phase,'alterFuture');assert.equal(E.project(g,'p0').future.length,3);assert(!('future'in E.project(g,'p1')));
 const old=structuredClone(g),ids=g.future.map(c=>c.id);
 for(const order of [[],[ids[0],ids[0],ids[1]],[...ids,'unknown'],['unknown',ids[1],ids[2]],null]) assert.throws(()=>act(g,'orderFuture',{order}));
 assert.throws(()=>act(g,'orderFuture',{order:ids},'p1'));assert.deepEqual(g,old);
 const tail=g.deck.slice(3);g=invariant(act(g,'orderFuture',{order:[ids[1],ids[2],ids[0]]}));assert.equal(g.phase,'action');assert.equal(g.current,'p0');assert.deepEqual(g.deck.slice(3),tail);assert.equal(g.deck[0].faceUp,true);assert.equal(g.budget,29999);
});
test('改变未来少于三张可重排；超时原序，不限时不自动结束',()=>{
 let g=game([['alterFuture']],['skip','imploding']);g=settle(play(g));g=act(g,'orderFuture',{order:g.future.map(c=>c.id).reverse()});assert.equal(g.deck[0].type,'imploding');
 g=game([['alterFuture']]);g=settle(play(g));const deck=g.deck;g=settle(g);assert.equal(g.phase,'action');assert.deepEqual(g.deck,deck);
 g=game([['alterFuture']],undefined,{noTurnTimer:true});g=settle(play(g));assert.equal(g.deadline,null);assert.equal(E.tick(g,{now:9999999}),g);
});
test('野猫只能替代同一种普通猫或全野猫，支持对子三张，不混功能牌',()=>{
 for(const types of [['feral','cat1'],['feral','feral'],['cat2','feral','cat2'],['feral','feral','feral']]) {
 let g=game([types,['defuse']]);g=settle(play(g,types.map((_,i)=>'c'+i),{target:'p1',named:'defuse'}));assert.equal(g.players[0].hand[0].type,'defuse');invariant(g);
 }
 for(const types of [['feral'],['feral','attack'],['feral','cat1','cat2']]){const g=game([types,['defuse']]);assert.throws(()=>play(g,types.map((_,i)=>'c'+i),{target:'p1',named:'defuse'}));}
});
test('三张点名可索扩展但不能危险牌；基础版不能点名扩展',()=>{
 let g=game([['cat1','cat1','feral'],['reverse']]);g=settle(play(g,['c0','c1','c2'],{target:'p1',named:'reverse'}));assert.equal(g.players[0].hand[0].type,'reverse');
 for(const named of ['bomb','imploding']) assert.throws(()=>play(game([['cat1','cat1','feral']]),['c0','c1','c2'],{target:'p1',named}));
 g=game([['cat1','cat1','cat1']]);g.rulesVersion='ek-original-2025-online-v1';assert.throws(()=>play(g,['c0','c1','c2'],{target:'p1',named:'reverse'}));
});
test('旧六人快照仍按旧牌库继续，不在加载/操作时注入扩展',()=>{
 let g=structuredClone(require('./fixtures/legacy-six-game.json'));assert.equal(g.totalCards,57);assert.equal(g.rulesVersion,'ek-original-2025-friends-6p-v1');
 g=E.command(g,g.current,{type:'draw'},{now:2000});invariant(g);assert.equal(g.totalCards,57);assert(![...g.deck,...g.players.flatMap(p=>p.hand)].some(c=>extra.includes(c.type)));
});
test('重排后定向/普通攻击混合和反转债务的方向结果一致',()=>{
 let g=game([['attack'],['targetAttack'],[],['reverse','attack']]);
 g=settle(play(g));assert.equal(g.current,'p1');assert.equal(g.remaining,2);
 g=settle(act(g,'play',{cards:['c1'],target:'p3'},'p1'));assert.equal(g.remaining,4);
 g=settle(act(g,'play',{cards:['c2']},'p3'));assert.equal(g.remaining,3);assert.equal(g.current,'p3');assert.equal(g.direction,-1);
 g=settle(act(g,'play',{cards:['c3']},'p3'));assert.equal(g.remaining,5);assert.equal(g.current,'p2');
});
test('牌底第二次抽到翻面内爆即使有拆弹也出局，末两人即时结算',()=>{
 let g=game([['bottom','defuse']],['bomb','bomb','bomb','bomb',{type:'imploding',faceUp:true}]);g=invariant(settle(play(g)));assert.equal(g.players[0].alive,false);assert.equal(g.players[0].hand[0].type,'defuse');
 g=game([['defuse'],['defuse']],[{type:'imploding',faceUp:true}]);g.players.slice(2).forEach(p=>p.alive=false);g=invariant(act(g,'draw'));assert.equal(g.phase,'finished');assert.equal(g.winner,'p1');assert.equal(g.deadline,null);
});
test('改变未来被否定不会泄露牌顶，空牌列表不污染对方私密投影',()=>{
 let g=game([['alterFuture'],['nope']]);g=play(g);g=act(g,'nope',{cardId:'c1'},'p1');g=settle(g);assert.equal(g.phase,'action');assert.equal(g.future,null);for(const p of g.players)assert(!('future'in E.project(g,p.id)));
});
