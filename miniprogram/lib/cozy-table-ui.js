// Decorative scene rendering only. Commands, privacy and turn rules stay in CanvasUI/controller.
const U = require("./controller");
const BLUE = "#0071e3", INK = "#1d1d1f", MUTED = "#697281", RED = "#d9182b";
const TONES = {cat:"#efe7fa",defuse:"#e6f3e2",nope:"#fce5e8",attack:"#fff0d8",other:"#e6f1fc",bomb:"#f1b4b9"};
const PAWS = {cat:"#bc9cde",defuse:"#a3ca92",nope:"#efa6ae",attack:"#eec275",other:"#a0c9ea",bomb:RED};
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function paw(ui,x,y,size,color) {
  const c=ui.ctx;c.save();c.fillStyle=color;
  for(const [dx,dy,rx,ry,rotation] of [[0,.17,.25,.22,0],[-.31,-.11,.12,.16,-.4],[-.12,-.32,.12,.16,-.15],[.13,-.32,.12,.16,.15],[.32,-.1,.12,.16,.4]]) {
    c.beginPath();c.ellipse(x+dx*size,y+dy*size,rx*size,ry*size,rotation,0,Math.PI*2);c.fill();
  }
  c.restore();
}

function drawBackdrop(ui) {
  const entry=ui.image("cozy-room-v1.jpg");
  if(!entry?.ready) {ui.box(0,0,ui.w,ui.h,"#faf7f2",null,0);return;}
  const iw=entry.image.width,ih=entry.image.height;
  const scale=Math.max(ui.w/iw,ui.h/ih),sw=ui.w/scale,sh=ui.h/scale;
  ui.crop("cozy-room-v1.jpg",(iw-sw)/2,(ih-sh)/2,sw,sh,0,0,ui.w,ui.h);
  // UI stays readable while room details live at the edges.
  ui.box(0,0,ui.w,ui.h,"rgba(255,255,255,.18)",null,0);
}

function drawFoldedCard(ui,raw,x,y,w,h,exposed) {
  const card=raw.name?raw:U.card(raw),tone=TONES[card.spineTone]||TONES.other;
  const faceW=Math.min(w,exposed),pad=4;
  ui.ctx.save();ui.ctx.shadowColor="rgba(58,45,31,.08)";ui.ctx.shadowBlur=5;ui.ctx.shadowOffsetY=2;
  ui.box(x,y,w,h,card.type==="bomb"?"#fff1f2":"#ffffff","#e3e3e8",11);ui.ctx.restore();
  ui.box(x+3,y+4,w-6,h-8,tone,null,8);
  const size=h<95?10:11;
  const lines=ui.lines(card.name.replace(/ ×/g,"×"),faceW-pad*2,size);
  const titleH= Math.min(h<95?28:36,Math.max(size+6,lines.length*(size+2)+4));
  lines.slice(0,2).forEach((line,i)=>ui.text(line,x+faceW/2,y+9+i*(size+2),size,card.type==="bomb"?RED:INK,"center",600,faceW-6));
  // Artwork is placed in the exposed strip, so neighbouring cards never hide its entire subject.
  const pawSize=h<95?13:18,pawY=y+h-(h<95?11:15);
  const art={x:x+pad,y:y+titleH,w:faceW-pad*2,h:Math.max(18,pawY-pawSize/2-(y+titleH)-6)};
  ui.cardArt(card,art.x,art.y,art.w,art.h);
  paw(ui,x+faceW/2,pawY,pawSize,PAWS[card.spineTone]||PAWS.other);
  return {id:card.id,art,paw:{x:x+faceW/2,y:pawY,size:pawSize}};
}

function drawBoard(ui,y,h) {
  const d=ui.page.data,v=d.v,g=d.room.game,x=12,w=ui.w-24,c=ui.ctx;
  ui.layout.table={x,y,w,h};
  const tiny=h<120,compact=h<260;
  const portrait=tiny?Math.max(12,h*.24):compact?clamp(Math.floor(h*.23/2)*2,h<150?26:36,42):clamp(Math.floor(Math.min(w*.19,h*.18)/2)*2,48,72);
  // Table fits the available zone instead of being baked into the backdrop.
  c.save();c.shadowColor="rgba(128,94,45,.16)";c.shadowBlur=10;c.shadowOffsetY=4;
  c.beginPath();c.ellipse(x+w/2,y+h/2,Math.max(1,w*.48),Math.max(1,h*.47),0,0,Math.PI*2);
  const gradient=c.createLinearGradient?.(x,y,x+w,y+h);
  if(gradient?.addColorStop) {gradient.addColorStop(0,"#fff9ec");gradient.addColorStop(1,"#f0e4d0");}
  c.fillStyle=gradient||"#f5ebd9";c.fill();
  c.shadowColor="transparent";c.lineWidth=compact?4:7;c.strokeStyle="#e6d3b3";c.stroke();c.restore();
  c.save();c.beginPath();c.ellipse(x+w/2,y+h/2,w*.465,Math.max(1,h*.452),0,0,Math.PI*2);c.strokeStyle="#fff5e4";c.lineWidth=2;c.stroke();c.restore();
  if(!compact) {
    paw(ui,x+w*.33,y+h*.3,18,"rgba(213,187,145,.32)");
    paw(ui,x+w*.65,y+h*.76,22,"rgba(213,187,145,.28)");
    paw(ui,x+w*.58,y+h*.17,14,"rgba(213,187,145,.25)");
  }
  const timer=d.nopeInfo?.done?"已响应":d.countdown===null?"∞":(d.countdown||0)+"s";
  const summary=g.phase==="finished"?v.winnerName+"获胜":`${v.phaseTitle} · ${g.remaining} 回合${timer==="∞"?"":" · "+timer}`;
  for(const [i,p] of (v.tablePlayers||[]).entries()) {
    const match=p.seatStyle?.match(/left:([\d.]+)%;top:clamp\(52px,([\d.]+)%/);
    const px=match?Number(match[1]):50,py=match?Number(match[2]):i?10:90;
    const as=p.isMe?portrait+(tiny?0:compact?4:4):portrait;
    const sw=p.isMe?Math.min(w-8,compact?128:as+116):compact?76:portrait+28;
    const labelH=tiny?0:compact?16:38,sh=p.isMe?as+4:as+3+labelH;
    const sx=clamp(x+w*px/100-(p.isMe&&!compact?as/2:sw/2),x+3,x+w-sw-3);
    let sy=p.isMe?y+h-sh-4:clamp(y+h*py/100-sh/2,y+4,y+h-sh-4);
    if(!p.isMe&&compact&&v.tablePlayers.length===5&&py===47)sy=Math.max(sy,y+portrait+labelH+11);
    const ax=p.isMe?sx:sx+(sw-as)/2;
    ui.avatar(p,ax,sy,as,p.active&&g.phase!=="finished");
    if(p.active&&g.phase!=="finished") {
      c.save();c.strokeStyle=BLUE;c.lineWidth=2;c.beginPath();c.arc(ax+as/2,sy+as/2,as/2+1,0,Math.PI*2);c.stroke();c.restore();
    }
    if(p.isMe) {
      ui.text(p.name+" · 你",sx+as+8,sy+as*.36,compact?13:16,INK,"left",600,sw-as-8);
      ui.text(!p.alive?"已出局":compact?`${v.phaseTitle}·${g.remaining}回合·${timer}`:p.count+" 张牌",sx+as+8,sy+as*.72,compact?8:12,MUTED,"left",400,sw-as-8);
    } else if(!tiny) {
      const ly=sy+as+3;
      ui.box(sx,ly,sw,labelH,"rgba(255,255,255,.88)",null,compact?7:12);
      if(compact) {
        const count=p.alive?p.count+" 张":"出局";
        ui.font(9);const countW=c.measureText(count).width;
        ui.font(11,600);const nameW=Math.min(c.measureText(p.name).width,sw-countW-14),lx=sx+(sw-nameW-countW-6)/2;
        ui.text(p.name,lx,ly+8,11,INK,"left",600,nameW);ui.text(count,lx+nameW+6,ly+8,9,MUTED);
      } else {
        ui.text(p.name,sx+sw/2,ly+11,portrait>=60?15:14,INK,"center",600,sw-8);
        ui.text(p.alive?p.count+" 张牌":"已出局",sx+sw/2,ly+28,12,MUTED,"center");
      }
    }
    ui.layout.seats.push({x:sx,y:sy,w:sw,h:sh,id:p.id,isMe:p.isMe});
  }
  const centerOffset=compact?Math.max(portrait+23,h*.34):Math.max(portrait+52,h*.34);
  const cw=compact?48:clamp(Math.round(w*.2),68,86),ch=compact?Math.max(16,Math.min(Math.floor(h*.22),44,h-portrait-centerOffset-26)):clamp(Math.round(h*.27),84,122);
  const centerY=y+centerOffset;
  const leftX=ui.w/2-cw-10,rightX=ui.w/2+10;
  const danger=v.deckTop?"牌顶":v.deckBottom?"牌底":null;
  ui.layout.piles=[{x:leftX,y:centerY,w:cw,h:ch},{x:rightX,y:centerY,w:cw,h:ch}];
  for(const shift of [5,3,0])ui.box(leftX+shift,centerY+shift,cw,ch,danger?"#fff1f2":"#dceaff",danger?RED:BLUE,compact?7:11);
  if(compact) {
    ui.text(danger||"剩余",leftX+cw/2,centerY+9,9,danger?RED:BLUE,"center");
    ui.text(g.deckCount+" 张",leftX+cw/2,centerY+ch-9,16,danger?RED:BLUE,"center",700);
  } else {
    ui.box(leftX+5,centerY+5,cw-10,ch-10,"#cbe2fc",null,8);
    paw(ui,leftX+cw*.4,centerY+ch*.43,23,"#465365");paw(ui,leftX+cw*.65,centerY+ch*.62,19,"#465365");
    ui.text("剩余 "+g.deckCount+" 张",leftX+cw/2,centerY+ch+14,15,BLUE,"center",700,cw+32);
  }
  if(danger)ui.text(danger+"有内爆猫",leftX+cw/2,centerY+ch+(compact?5:31),9,RED,"center",600,cw+18);
  if(v.discard&&compact) {ui.box(rightX,centerY,cw,ch,"#fff","#e3e3e8",8);ui.cardArt(v.discard,rightX+3,centerY+3,cw-6,ch-6);}
  else if(v.discard) {
    const discard=v.discard,artH=ch-44;
    ui.box(rightX,centerY,cw,ch,discard.type==="bomb"?"#fff1f2":"#fff","#e3e3e8",12);
    ui.cardArt(discard,rightX+5,centerY+5,cw-10,artH);
    ui.text(discard.name,rightX+cw/2,centerY+artH+15,12,discard.type==="bomb"?RED:INK,"center",600,cw-8);
    ui.lines(discard.short.replace(/\s+/g,""),cw-12,9).slice(0,2).forEach((line,i)=>ui.text(line,rightX+cw/2,centerY+artH+28+i*10,9,MUTED,"center"));
  }
  else {ui.box(rightX,centerY,cw,ch,"rgba(255,255,255,.55)","#ded6c7",10);ui.text("出牌区",rightX+cw/2,centerY+ch/2,11,MUTED,"center");}
  ui.text(compact&&v.discard?v.discard.name:"弃牌堆",rightX+cw/2,centerY+ch+(compact?6:14),compact?9:12,MUTED,"center");
  if(!compact)ui.text(summary,ui.w/2,centerY+ch+(danger?52:38),14,BLUE,"center",600,w-20);
}

module.exports={drawBackdrop,drawBoard,drawFoldedCard,paw};
