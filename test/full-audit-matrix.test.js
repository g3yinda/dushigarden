'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../server/engine'),U=require('../web/controller'),{chooseAction}=require('../server/bots');
function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};}
const toggles=[true,false];
for(const n of [2,3,4,5,6]) for(const noTurnTimer of toggles) for(const allowNopeChain of toggles) for(const nopeSeconds of [10,20,30,0]){
 const expansion=n===6? toggles.flatMap(includeImploding=>toggles.map(includeReverse=>({includeImploding,includeReverse}))):[{}];
 for(const extra of expansion){
  const options={noTurnTimer,allowNopeChain,nopeSeconds,...extra};
  test(`${n}人完整配置对局 ×3 ${JSON.stringify(options)}`,()=>{
   for(let seed=1;seed<=3;seed++){
    const rng=seeded(seed+n*97+nopeSeconds*101),players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'验收猫'+i,avatar:i%4}));
    let now=1000,g=E.createGame(players,{...options,now,rng,id:'matrix'}),steps=0;
    const played=new Map();
    assert.equal(g.rulesVersion,n===6?'ek-imploding-2023-online-v1':'ek-original-2025-online-v1');
    const original=[...g.deck,...g.players.flatMap(p=>p.hand)];
    assert.equal(original.filter(c=>c.type==='imploding').length,n===6&&extra.includeImploding?1:0);
    assert.equal(original.filter(c=>c.type==='reverse').length,n===6&&extra.includeReverse?4:0);
    assert.equal(g.deck.length,n===6?(extra.includeReverse?28:24):({2:35,3:29,4:23,5:16}[n]));
    while(g.phase!=='finished' && steps++<2000){
     const actor=g.phase==='favor'?g.pending.target:g.phase==='nope'?g.players.find(p=>g.pending.responses[p.id]==='waiting')?.id:g.current;
     assert(actor,'active phase must have an eligible player');
     const room={me:actor,players,game:E.project(g,actor)},key=[g.turnNumber,g.current,g.remaining,actor].join(':');
     const action=chooseAction(room,{rng,played:played.get(key)||0,respondNope:true});
     assert(action,'legal phase must have a client action');
     const before={me:'p0',game:E.project(g,'p0')};
     if(action.type==='play')played.set(key,(played.get(key)||0)+1);
     now+=1;g=E.command(g,actor,action,{now,rng});E.assertInvariant(g);
     if(steps===35){const restored=JSON.parse(JSON.stringify(g));assert.deepEqual(E.project(restored,actor),E.project(g,actor));g=restored;}
     for(const recipient of players){
      const view=E.project(g,recipient.id);
      assert(!('deck' in view));assert(view.players.every(p=>!('hand' in p)));
      if(!['future','alterFuture'].includes(g.phase)||recipient.id!==g.current)assert(!('future' in view));
      for(const edge of ['deckTop','deckBottom'])if(view[edge])assert(view[edge].type==='imploding'&&view[edge].faceUp);
     }
     const after={me:'p0',game:E.project(g,'p0')};
     for(const effect of U.motions(before,after).filter(e=>e.explosion)){
      assert.equal(effect.actor.id,actor);assert.equal(effect.actionText,'抽到了炸弹猫！');assert.equal(effect.card.type,'bomb');
     }
     if(g.phase!=='finished')assert.equal(g.deadline===null,g.phase==='nope'?nopeSeconds===0:noTurnTimer);
    }
    assert.equal(g.phase,'finished','all configuration combinations must finish');
    assert.equal(g.players.filter(p=>p.alive).length,1);assert(g.winner);
   }
  });
 }
}
