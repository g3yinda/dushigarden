"use strict";
const U = BoomUI,
  $ = (s) => document.querySelector(s),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const S = {
  token: sessionStorage.getItem("boom.token"),
  name: localStorage.getItem("boom.name") || "",
  avatar: Number(localStorage.getItem("boom.avatar") || 0),
  room: null,
  selected: [],
  modal: null,
  target: "",
  named: "defuse",
  position: 1,
  futureState: null,
  busy: false,
  localMode: false,
  botCount: 1,
  respondNope: false,
  noTurnTimer: false,
  nopeSeconds: 10,
  allowNopeChain: true,
  includeImploding: true,
  includeReverse: true,
  nopeInfo: null,
  handExpanded: false,
  error: "",
  connection: "",
  settings: JSON.parse(
    localStorage.getItem("boom.settings") || '{"reduced":false,"sound":false}',
  ),
  poll: 0,
  clockOffset: 0,
};
const motionPlayer = U.createMotionPlayer({
  show: (effect) => {
    S.motion = effect;
    renderMotion();
  },
});
function positionMotion() {
  const host = $("#motion-host"), bounds = $(".board-stage")?.getBoundingClientRect?.();
  if (!host?.style) return;
  Object.assign(host.style, bounds ? { left: bounds.left + "px", top: bounds.top + "px", width: bounds.width + "px", height: bounds.height + "px" } : { left: "0", top: "0", width: "100%", height: "100%" });
}
function renderMotion() {
  const host = $("#motion-host");
  if (!host) return;
  if (S.motion && !["draw", "future"].includes(S.motion.kind))
    $(".board-stage")?.scrollIntoView?.({ block: "center", behavior: S.settings.reduced ? "instant" : "smooth" });
  positionMotion();
  const effect = S.motion;
  host.innerHTML = effect
    ? `<div class="motion-layer ${effect.kind} ${effect.explosion ? "explosion" : ""}">${effect.explosion ? '<div class="bomb-burst" aria-hidden="true"><i class="burst-ring"></i><i class="burst-spark s1"></i><i class="burst-spark s2"></i><i class="burst-spark s3"></i><i class="burst-spark s4"></i><i class="burst-spark s5"></i><i class="burst-spark s6"></i></div>' : ""}<div class="motion-tile" role="status">${effect.actor ? `<div class="motion-people">${avatar(effect.actor)}${effect.target ? `<span aria-hidden="true">→</span>${avatar(effect.target)}` : ""}</div>` : ""}${effect.relationship ? `<div class="motion-relationship">${esc(effect.relationship)}</div>` : ""}<div class="motion-action">${esc(effect.actionText || effect.title)}</div>${effect.card ? card(effect.card) : "◉"}${effect.count > 1 ? `<span class="motion-count">× ${effect.count}</span>` : ""}</div></div>`
    : "";
}
function avatar(p, cls = "") {
  let a = U.avatars[Number(p.avatar ?? p.id) % 4] || U.avatars[0];
  return `<div class="avatar ${cls}"><img src="/ui.jpg" alt="${esc(a.name)}猫" style="${a.style}"></div>`;
}
function card(c, select = false) {
  c = U.card(c);
  return `<${select ? "button" : "div"} class="card tone-${c.spineTone} ${S.selected.includes(c.id) ? "selected" : ""} ${select && c.compactHand ? "compact-hand" : ""}" ${select ? `data-action="card" data-id="${esc(c.id)}" aria-pressed="${S.selected.includes(c.id)}" aria-label="${esc(c.name)}，${esc(c.description)}"` : ""}><div class="card-art">${select ? `<div class="hand-art-crop" style="aspect-ratio:${c.handRatio};"><img alt="" src="/${c.source}" style="${c.handArt}"></div>` : `<img alt="" src="/${c.source}" style="${c.art}">`}${c.symbol ? `<span class="card-symbol" aria-hidden="true">${esc(c.symbol)}</span>` : ""}${c.stateLabel ? `<span class="card-state ${c.faceUp ? "face-up" : ""}">${esc(c.stateLabel)}</span>` : ""}</div>${select ? `<span class="card-spine tone-${c.spineTone}">${esc(c.name)}</span><span class="card-check" aria-hidden="true">✓</span>` : ""}<strong>${esc(c.name)}</strong><small>${esc(c.short)}</small></${select ? "button" : "div"}>`;
}
function btn(text, action, kind = "primary", disabled = false, extra = "") {
  return `<button class="${kind}" data-action="${action}" ${disabled || S.busy ? "disabled" : ""} ${extra}>${text}</button>`;
}
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").style.display = "block";
  clearTimeout(S.toast);
  S.toast = setTimeout(() => ($("#toast").style.display = "none"), 3200);
}
async function api(path, body, signal) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(S.token ? { Authorization: "Bearer " + S.token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const j = await r.json();
  if (!r.ok) {
    const e = Error(j.message || "连接暂时失败");
    e.status = r.status;
    throw e;
  }
  return j;
}
function accept(r) {
  if (!r) return;
  if (r.status === "closed") {
    S.poll++;
    motionPlayer.clear();
    Object.assign(S, {
      room: null, selected: [], modal: null, target: "",
      resume: false, connection: "", handExpanded: false,
      nopeInfo: null, futureState: null,
    });
    render();
    toast("房主已关闭房间，请重新开局");
    return;
  }
  const old = S.room;
  if (old?.code === r.code && old.revision > r.revision) return;
  S.room = r;
  S.futureState = U.futureOrder(r, S.futureState);
  if (!U.namedOptions(r).some(c => c.value === S.named)) S.named = "defuse";
  if (old?.code !== r.code || old?.game?.id !== r.game?.id)
    S.handExpanded = false;
  if (
    S.modal === "bots" &&
    !U.derive(r, [], S.localMode).botCounts.includes(S.botCount)
  )
    S.botCount = 1;
  S.clockOffset = r.serverNow - Date.now();
  S.selected = S.selected.filter((id) => r.game?.hand.some((c) => c.id === id));
  if (S.modal === "close-room" && !U.derive(r, S.selected).isHost) S.modal = null;
  if (old?.code !== r.code || U.contextChanged(old, r)) {
    if (old?.code !== r.code || !["leave", "close-room"].includes(S.modal)) S.modal = null;
    S.target = "";
    S.position = 1;
    if (S.settings.sound) tone();
  }
  if (old?.code !== r.code || old?.game?.id !== r.game?.id)
    motionPlayer.clear();
  U.motions(old, r).forEach((effect) => motionPlayer.push(effect));
  syncNopeResponse();
  render();
}
function syncNopeResponse() {
  S.nopeInfo = U.nopePanel(S.room, Date.now() + S.clockOffset);

}
async function session() {
  if (S.token) {
    await api("/profile", { name: S.name, avatar: S.avatar });
    return;
  }
  if (!S.name.trim()) throw Error("先给自己起个名字吧");
  let r = await api("/session", { name: S.name.trim(), avatar: S.avatar });
  S.token = r.token;
  sessionStorage.setItem("boom.token", S.token);
  localStorage.setItem("boom.name", S.name);
  localStorage.setItem("boom.avatar", S.avatar);
}
async function refresh() {
  if (!S.room) return;
  accept(await api("/rooms/" + S.room.code));
}
async function addBots() {
  const v = U.derive(S.room, [], S.localMode);
  if (S.busy || !v.canAddBots || !v.botCounts.includes(S.botCount)) return;
  S.busy = true;
  render();
  try {
    const r = await api("/rooms/" + S.room.code + "/bots", {
      count: S.botCount,
      respondNope: S.respondNope,
      revision: S.room.revision,
      commandId: crypto.randomUUID(),
    });
    S.modal = null;
    accept(r);
  } catch (e) {
    if (e.status === 409) {
      await refresh().catch(() => {});
      toast("房间人数或状态已变化，请查看最新房间后再添加 Bot");
    } else toast(e.message);
  } finally {
    S.busy = false;
    render();
  }
}
async function cmd(type, payload = {}) {
  if (S.busy || !S.room) return;
  S.busy = true;
  if (["leave", "closeRoom"].includes(type)) S.poll++;
  render();
  try {
    let r = await api("/rooms/" + S.room.code + "/command", {
      commandId: crypto.randomUUID(),
      revision: S.room.revision,
      gameId: S.room.game?.id,
      type,
      ...payload,
    });
    if (type === "leave") {
      S.resume = !!r;
      S.room = null;
      S.nopeInfo = null;
      S.futureState = null;
      motionPlayer.clear();
      S.selected = [];
      S.modal = null;
      render();
      return;
    }
    S.selected = [];
    S.modal = null;
    accept(r);
  } catch (e) {
    if (e.status === 409) {
      await refresh().catch(() => {});
    } else toast(e.message);
  } finally {
    S.busy = false;
    render();
    if (["leave", "closeRoom"].includes(type) && S.room) poll();
  }
}
async function poll() {
  let epoch = ++S.poll;
  while (S.room && epoch === S.poll) {
    try {
      const r = await api(
        "/rooms/" + S.room.code + "?after=" + S.room.revision,
      );
      if (epoch !== S.poll) return;
      S.connection = "";
      if (r && r.revision !== S.room.revision) accept(r);
    } catch (e) {
      if (epoch !== S.poll) return;
      if ([401, 403, 404, 410].includes(e.status)) {
        S.poll++;
        motionPlayer.clear();
        Object.assign(S, {
          room: null, modal: null, selected: [], target: "",
          resume: false, handExpanded: false, connection: "",
          nopeInfo: null, futureState: null,
        });
        if (e.status === 401) {
          S.token = null;
          sessionStorage.removeItem("boom.token");
        }
        render();
        toast(e.message);
        return;
      }
      S.connection = "连接中断，正在重连…";
      render();
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
}
function tone() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)(),
      o = c.createOscillator(),
      g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    g.gain.setValueAtTime(0.035, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
    o.frequency.value = 660;
    o.start();
    o.stop(c.currentTime + 0.16);
    o.onended = () => c.close();
  } catch {}
}
function lobby() {
  return `<div class="home-lobby ${S.resume ? "has-resume" : ""}"><div class="hero home-hero"><div class="home-hero-art" role="img" aria-label="2–6 人炸毛猫咪，可爱的白色猫咪抱着炸弹，前方摆着拆弹、攻击和跳过卡牌"><img src="/ui.jpg" alt=""><span class="hero-title">炸毛猫咪</span><span class="hero-count">2–6 人</span></div></div><p class="hero-rules-note">2–5 人基础版 · 6 人完整内爆猫扩展</p><div class="home-controls"><div class="identity">${btn(avatar({ avatar: S.avatar }), "profile", "avatar pick")}<div class="name-field"><input id="name" aria-label="你的昵称" maxlength="12" placeholder="给自己起个名字" value="${esc(S.name)}"></div></div><div class="home-actions">${S.resume ? btn("返回正在进行的对局", "resume") : ""}${btn("创建房间", "create")}${btn("加入房间", "join", "secondary")}</div></div><div class="home-footer">${btn("玩法说明 ›", "rules", "text-btn")}${btn("⚙", "settings", "circle", false, 'aria-label="设置"')}</div></div>`;
}
function waiting(r, v) {
  return `<div class="top">${btn("‹", "leave", "circle")}<h2>好友房</h2>${btn("⚙", "settings", "circle")}</div><div class="code"><span class="muted">房间号</span><strong>${esc(r.code)}</strong>${btn("复制房间号 ↗", "copy", "text-btn")}<p class="muted">把房间号分享给朋友，一起来玩吧！</p></div><p class="room-mode">${esc(v.rulesLabel)} · ${v.noTurnTimer ? "∞ 出牌不限时" : "出牌 30 秒"} · 否定 ${esc(v.nopeTimeLabel)}</p><div class="seats">${v.players.map((p) => `<div data-render-key="seat:${esc(p.id)}" class="seat">${avatar(p)}<strong>${esc(p.name)}${p.isBot ? " · Bot" : ""}${p.isMe ? " · 你" : ""}</strong><span class="${p.ready ? "ready" : "muted"}">${p.ready ? "✓ 已准备" : "◌ 等待准备"}${p.isHost ? " · 房主" : ""}</span>${v.isHost && !p.isMe ? btn("移出", "kick", "remove", false, `data-id="${esc(p.id)}"`) : ""}</div>`).join("")}${Array.from({ length: Math.max(0, 2 - v.players.length) }, () => '<div class="seat"><div class="avatar center" style="font-size:40px;padding-top:14px;color:#aab9c9">＋</div><span class="muted">等一位朋友</span></div>').join("")}</div>${btn("邀请朋友", "invite", "secondary")}${v.canAddBots ? btn("添加验证 Bot", "bots", "secondary") : ""}${btn(v.ready ? "取消准备" : "我准备好了", "ready", v.isHost ? "secondary" : "primary")}${v.isHost ? btn("开始游戏", "start", "primary", !v.canStart) : '<p class="center muted space">大家准备后，由房主开始游戏</p>'}<p class="center muted small space">${r.players.length}/6 人 · 每人 8 张起手牌</p>`;
}
function game(r, v) {
  const g = r.game;
  const finished = g.phase === "finished";
  const table = `<div class="board-stage" aria-label="大家的共同牌桌"><div class="table-felt"></div>${v.tablePlayers.map((p) => `<div data-render-key="table:${esc(p.id)}" class="table-seat ${p.isMe ? "self-seat" : ""} ${p.active && !finished ? "active" : ""} ${!p.alive ? "out" : ""}" style="${p.seatStyle}">${avatar(p)}<div class="seat-info"><strong>${esc(p.name)}${p.isMe ? " · 你" : ""}</strong><span>${p.alive ? p.count + " 张牌" : "已出局"}</span></div>${p.active && !finished ? '<span class="turn-dot" aria-label="正在行动"></span>' : ""}</div>`).join("")}<div class="board-center"><div class="turn-label"><strong>${esc(finished ? v.winnerName + "获胜" : v.phaseTitle)}</strong>${!finished ? `<span>${g.remaining} 回合 · <span data-countdown></span></span>` : "<span>最后的幸存者 🐾</span>"}</div><div class="piles"><div class="pile"><div class="card-back">🐾</div><span>牌堆 ${g.deckCount}</span></div><div class="pile">${v.discard ? card(v.discard) : '<div class="empty-pile">出牌区</div>'}<span>弃牌堆</span></div></div></div></div>`;
  return `<div class="top game-header">${btn("‹", "leave", "circle")}<div class="roomtitle"><h2>炸毛猫咪</h2><p class="muted">房间号 ${esc(r.code)}</p></div>${btn("⚙", "settings", "circle")}</div><div class="game-room">${table}${v.deckTop || v.deckBottom ? `<div class="deck-hazards" role="status">${v.deckTop ? "✹ 牌顶：翻面内爆猫 · 抽到即出局" : ""}${v.deckTop && v.deckBottom ? "<br>" : ""}${v.deckBottom ? "✹ 牌底：翻面内爆猫 · 抽到即出局" : ""}</div>` : ""}${finished ? `<div class="winner"><h2>${esc(v.winnerName)}获胜</h2><p class="muted space">这一次，幸运站在你这边。</p>${v.isHost ? btn("再来一局", "rematch") : '<p class="muted space">等待房主再开一局</p>'}${btn("返回大厅", "leave", "secondary")}</div>` : `<div class="hand-area">${phase(r, v)}${!v.alive ? '<div class="notice">你已出局，正在旁观。</div>' : ""}<div class="hand-caption"><strong>手牌 <span>${g.hand.length}</span></strong><div class="hand-controls">${btn(`<span class="hand-toggle-label">${S.handExpanded ? "收起手牌" : "展开手牌"}<span class="hand-chevron ${S.handExpanded ? "up" : ""}" aria-hidden="true"></span></span>`, "hand-toggle", "text-btn hand-toggle", false, `aria-expanded="${S.handExpanded}"`)}${S.selected.length ? btn(`<span class="hand-toggle-label">取消选择</span>`, "clear", "text-btn hand-toggle hand-clear") : ""}</div></div><div class="hand ${S.handExpanded ? "expanded" : ""}" role="group" aria-label="可滑动的手牌"><div class="hand-row">${g.hand.map((c) => card(c, true)).join("")}</div></div>${S.selected.length ? `<div class="selection-preview"><div class="selection-title">已选 ${v.selectedCards.length} 张 · ${v.selectedCards.map((c) => esc(c.name)).join("、")}${S.selected.length === 1 ? btn("详情", "detail", "text-btn") : ""}</div>${!v.selection.valid && !v.canGive ? `<p>${esc(v.selection.hint)}</p>` : ""}</div>` : ""}<div class="table-dock">${nopeBar()}<div class="action-bar table-actions" role="group" aria-label="对局操作">${v.canGive ? btn("交牌", "give") : btn("打出" + (S.selected.length > 1 ? " · " + S.selected.length + " 张" : ""), "prepare", "primary", !v.selection.valid)}${btn("抽牌", "draw", "secondary", !v.canDraw)}</div></div></div>`}</div><details class="logs"><summary>对局动态 · 点击展开</summary>${(
    v.privateLog || []
  )
    .slice(-3)
    .map((l) => `<p class="private-log">仅你可见 · ${esc(l.text)}</p>`)
    .join("")}${(v.logs || [])
    .slice(-5)
    .map((l) => `<p>${esc(l.text)}</p>`)
    .join("")}</details>`;
}
function phase(r, v) {
  let g = r.game;
  if (g.phase === "alterFuture" && S.futureState && v.turn)
    return `<div class="phase reorder-phase"><h3>秘密调整未来</h3><p>从上到下是牌顶顺序，第一张将最先抽到。上下移动后，点确认顺序；只有你能看到。</p><div class="future-order">${S.futureState.cards.map((c, i) => `<div class="future-order-row"><span class="future-rank">${i + 1}</span>${card(c)}<div class="future-moves">${btn("↑ 上移", "future-up", "secondary future-move", !c.canUp, `data-id="${esc(c.id)}" aria-label="上移${esc(c.name)}"`)}${btn("↓ 下移", "future-down", "secondary future-move", !c.canDown, `data-id="${esc(c.id)}" aria-label="下移${esc(c.name)}"`)}</div></div>`).join("")}</div>${btn("确认顺序，继续回合", "orderFuture", "primary", !S.futureState.canConfirm)}</div>`;
  if (g.phase === "future" && g.future && v.turn)
    return `<div class="phase"><h3>悄悄看，只有你知道</h3><p>从左到右，第一张是下一次会抽到的牌。</p><div class="future">${g.future.map((c, i) => `<div><p class="small muted center">第 ${i + 1} 张</p>${card(c)}</div>`).join("")}</div>${btn("看好了，继续", "closeFuture")}</div>`;
  if (g.phase === "favor" && g.pending?.target === v.myId)
    return '<div class="phase"><h3>送出一张牌</h3>请在手牌中只选择一张，再点击交出。</div>';
  if (g.phase === "defuse" && v.turn)
    return `<div class="phase"><h3>抽到炸毛猫咪了！</h3>用拆弹稳稳保命，再秘密放回炸弹。${btn("使用拆弹", "defuse")}</div>`;
  if (g.phase === "insert" && v.turn)
    return `<div class="phase"><h3>${esc(v.insertTitle)}</h3><p>${esc(v.insertHint)}</p><label for="position">选择插入位置</label><select id="position">${v.positions.map((p) => `<option value="${p.value}" ${S.position === p.value ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>${btn("确认放回", "insert")}</div>`;
  return "";
}
function nopeBar() {
  const info = S.nopeInfo;
  const description = info?.active ? `${info.actorName} · ${info.actionName}；${info.stateText}；${info.statusText || "选择不出后，本轮不能更改"}；等待 ${info.waiting} 位玩家` : "当前没有可响应的动作";
  return `<div class="nope-banner ${info?.canPass ? "awaiting" : ""} ${info?.canPass && !info.unlimited && info.remaining <= 3 ? "urgent" : ""}" data-nope-panel title="${esc(description)}" aria-label="${esc(description)}"><div class="nope-banner-copy"><h3>是否选择否定？</h3><div class="nope-timer-line"><div class="nope-progress" aria-hidden="true"><span data-nope-progress style="width:${info?.progress || 0}%"></span></div><span class="nope-timer-text" data-nope-timer>${esc(info?.timerText || "")}</span></div></div><div class="nope-choices">${btn(esc(info?.buttonText || "打出否定"), "nope-response", "secondary nope-choice nope-play", !info?.canNope, `data-window="${esc(info?.key)}"`)}${btn("本次不出", "nope-pass", "secondary nope-choice", !info?.canPass, `data-window="${esc(info?.key)}"`)}</div></div>`;
}
function modal() {
  if (!S.modal) return "";
  let body = "",
    title = "";
  let v = U.derive(S.room, S.selected, S.localMode);
  switch (S.modal) {
    case "create":
      title = "一起开一局";
      body = `<div class="create-fields"><label class="switch create-row"><span class="setting-copy"><span class="setting-title">出牌不倒计时</span><span class="setting-caption">开启后，除否定外均不限时</span></span><input id="no-turn-timer" type="checkbox" aria-label="出牌不倒计时" ${S.noTurnTimer ? "checked" : ""}></label><div class="create-time"><div class="setting-label" id="nope-time-label">否定响应时长</div><div class="nope-options" role="group" aria-labelledby="nope-time-label">${[10, 20, 30, 0].map(seconds => btn(seconds === 0 ? "不限时" : seconds + " 秒", "nope-time", "nope-option " + (S.nopeSeconds === seconds ? "chosen" : ""), false, `data-seconds="${seconds}" aria-pressed="${S.nopeSeconds === seconds}"`)).join("")}</div></div><label class="switch create-row"><span class="setting-copy"><span class="setting-title">可循环否定</span><span class="setting-caption">可否定上一张否定</span></span><input id="allow-nope-chain" type="checkbox" aria-label="可循环否定" ${S.allowNopeChain ? "checked" : ""}></label><div class="create-expansion"><div class="setting-copy"><span class="setting-title">六人扩展规则</span><span class="setting-caption">2–5 人沿用基础版</span></div><div class="expansion-settings"><label class="switch create-row"><span class="setting-copy"><span class="setting-title">加入内爆猫</span><span class="setting-caption">${S.includeImploding ? "首抽翻面，再抽出局" : "关闭：使用 5 张普通炸弹"}</span></span><input id="include-imploding" type="checkbox" aria-label="加入内爆猫" ${S.includeImploding ? "checked" : ""}></label><label class="switch create-row"><span class="setting-copy"><span class="setting-title">加入反转</span><span class="setting-caption">改变方向，免抽一个回合</span></span><input id="include-reverse" type="checkbox" aria-label="加入反转" ${S.includeReverse ? "checked" : ""}></label></div></div></div><div class="create-footer">${btn("创建好友房", "create-submit")}</div>`;
      break;
    case "bots":
      title = "添加验证 Bot";
      body = `<p class="muted">Bot 会自动准备并参与对局。你仍需要点击准备，再开始游戏。</p><label for="bot-count">添加数量</label><select id="bot-count">${v.botCounts.map((count) => `<option value="${count}" ${count === S.botCount ? "selected" : ""}>${count} 位 Bot</option>`).join("")}</select><label class="switch">Bot 使用否定牌<input id="bot-nope" type="checkbox" ${S.respondNope ? "checked" : ""}></label><p class="muted">默认关闭，方便观察卡牌效果；开启后 Bot 会在响应窗口使用否定牌。</p>${btn("添加 Bot", "bots-submit", "primary", !v.canAddBots || !v.botCounts.includes(S.botCount))}`;
      break;
    case "detail":
      title = v.detail?.name || "卡牌详情";
      body = v.detail
        ? `<div class="detail-card">${card(v.detail)}</div><p>${esc(v.detail.description)}</p><p>单张使用和同名组合的规则不同，确认出牌前可以取消选择。</p>`
        : "";
      break;
    case "profile":
      title = "选一只代表你的猫";
      body = `<div class="avatars">${U.avatars.map((a) => btn(avatar({ avatar: a.id }), "avatar", "avatar pick " + (S.avatar === a.id ? "chosen" : ""), false, `data-id="${a.id}" aria-label="${a.name}"`)).join("")}</div>`;
      break;
    case "join":
      title = "加入朋友的房间";
      body =
        '<label for="code">六位房间号</label><input id="code" inputmode="numeric" maxlength="6" placeholder="输入房间号" autocomplete="off">' +
        btn("一起玩", "join-submit");
      break;
    case "settings":
      title = "轻松一点，按你的习惯";
      body = `<label class="switch">减弱动态<input id="reduced" type="checkbox" ${S.settings.reduced ? "checked" : ""}></label><label class="switch">回合提示音<input id="sound" type="checkbox" ${S.settings.sound ? "checked" : ""}></label><p>开启后，在阶段变化时播放轻柔提示音。</p>${btn("玩法说明", "rules", "secondary")}`;
      break;
    case "rules":
      title = "活到最后，就赢了";
      body = `<ol><li>2–6 位朋友，每人 8 张牌，至少有 1 张拆弹。2–5 人用基础版，6 人加入完整内爆猫扩展。</li><li>轮到你，可以先出牌，再抽一张结束回合。抽到炸弹，拆弹保命；没有拆弹则出局。</li><li>攻击把回合转给下家，跳过免抽一次。预知、索要、洗牌用完仍需继续行动。</li><li>否定时长可选10、20、30秒或不限时，默认10秒。开启“可循环否定”后可反否定，每层独立响应。</li><li>两张同名随机拿对方一张牌；三张同名指定想要的牌名，没有则落空。</li><li>超时会自动抽牌、拆弹或完成必选操作；断线不暂停整桌。</li></ol><p>六人扩展：内爆猫首次抽到翻面秘密插回，再次抽到直接出局；不能拆弹。定向攻击可指定自己，反转改变方向并免抽一个回合，抽牌底从底部抽牌，调整未来可秘密重排前三张。野猫只能替代普通猫组成组合。</p><p>拆弹后的炸弹可放在牌堆任意位置，只有你知道。最后一只存活的猫获胜。</p>`;
      break;
    case "play":
      title = v.selection.needsTarget ? v.targetLabel : "确认出牌";
      body = `<div class="play-preview">${v.selectedCards.map((c) => card(c)).join("")}</div><p class="muted">${esc(v.selection.hint)}</p>${v.selection.needsTarget ? `<label>${esc(v.targetLabel)}</label><div class="target-grid">${v.targets.map((p) => btn(avatar(p) + `<strong>${esc(p.name)}${p.isMe ? " · 你" : ""}${p.isBot ? " · Bot" : ""}</strong><span>${p.count} 张牌</span>`, "target", "target-option " + (S.target === p.id ? "chosen" : ""), false, `data-id="${esc(p.id)}" aria-pressed="${S.target === p.id}"`)).join("")}</div>` : ""}${
        v.selection.needsNamed
          ? `<label for="named">声明想要的牌名</label><select id="named">${v.namedOptions
              .map(
                ({value: k, label: n}) =>
                  `<option value="${k}" ${k === S.named ? "selected" : ""}>${n}</option>`,
              )
              .join("")}</select>`
          : ""
      }${btn("确认打出", "play", "primary", !v.selection.valid || (v.selection.needsTarget && !S.target))}`;
      break;
    case "leave":
      title = S.room?.status === "playing" ? "暂时离开这一局？" : "离开房间？";
      body = `<p>${S.room?.status === "playing" ? "你的席位将由系统托管到本局结束。回来后可继续原局，期间不能加入其他房间。" : "离开后可以重新创建或加入朋友的房间。"}</p>${btn(v.isHost ? "仅自己离开" : "确认离开", "leave-submit")}${v.isHost ? `<div class="close-room-option"><p>也可以结束这桌游戏，让大家一起返回大厅。</p>${btn("关闭整个房间", "close-room", "danger-secondary")}</div>` : ""}`;
      break;
    case "close-room":
      title = "关闭整个房间？";
      body = `<p class="close-explanation">当前对局将立即终止，不产生胜者。所有成员返回大厅，房间号失效。</p><p class="muted space">关闭后无法恢复这一局。</p>${btn("确认关闭房间", "close-room-submit", "danger-primary")}${btn("继续游戏", "close", "secondary")}`;
      break;
  }
  return `<div class="overlay-screen ${S.modal === "create" ? "create-overlay" : ""} ${["play", "create", "close-room"].includes(S.modal) ? "centered" : ""}"><section class="sheet ${S.modal === "create" ? "create-sheet" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="top"><h2>${title}</h2>${btn("×", "close", "circle")}</div>${body}</section></div>`;
}
function render() {
  document.body.classList.toggle("reduced", S.settings.reduced);
  document.body.classList.toggle("home-page", !S.room);
  const r = S.room,
    v = U.derive(r, S.selected, S.localMode);
  const handScroll = $(".hand")?.scrollLeft || 0;
  const html =
    `<div class="shell ${!r ? "home-shell" : ""} ${r?.game && r.game.phase !== "finished" ? "table-playing" : ""}">${!r ? lobby() : r.status === "aborted" ? `<h2>这局已中止</h2><p class="muted space">房间已结束，请返回大厅重新开局。</p>${btn("回大厅", "leave-submit")}` : r.game ? game(r, v) : waiting(r, v)}${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ""}<p class="connections center space">${esc(S.connection)}</p></div>${modal()}`;
  const app = $("#app");
  if (document.createElement && typeof BoomDOM !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;
    BoomDOM.patchChildren(app, template.content);
  } else app.innerHTML = html;
  if ($(".hand")) $(".hand").scrollLeft = handScroll;
  positionMotion();
  countdown();
}
function countdown() {
  syncNopeResponse();
  const info = S.nopeInfo;
  for (const timer of document.querySelectorAll?.("[data-nope-timer]") || [])
    timer.textContent = info?.timerText || "";
  for (const panel of document.querySelectorAll?.("[data-nope-panel]") || []) {
    panel.classList.toggle("awaiting", !!info?.canPass);
    panel.classList.toggle("urgent", !!info?.canPass && !info.unlimited && info.remaining <= 3);
  }
  for (const bar of document.querySelectorAll?.("[data-nope-progress]") || [])
    bar.style.width = (info?.progress ?? 0) + "%";
  for (const button of document.querySelectorAll?.('[data-action="nope"], [data-action="nope-response"]') || [])
    button.disabled = S.busy || !info?.canNope;
  for (const button of document.querySelectorAll?.('[data-action="nope-pass"]') || [])
    button.disabled = S.busy || !info?.canPass;
  const node = $("[data-countdown]");
  if (!node) return;
  if (info?.done) { node.textContent = "已响应"; return; }
  if (!S.room?.game?.deadline) {
    node.textContent = "∞";
    return;
  }
  node.textContent =
    Math.max(
      0,
      Math.ceil((S.room.game.deadline - Date.now() - S.clockOffset) / 1000),
    ) + "s";
}
setInterval(countdown, 250);
document.addEventListener("scroll", positionMotion, { passive: true, capture: true });
document.defaultView?.addEventListener("resize", positionMotion);
document.addEventListener("input", (e) => {
  if (e.target.id === "name") S.name = e.target.value;
  if (e.target.id === "position") S.position = Number(e.target.value);
  if (e.target.id === "named") S.named = e.target.value;
  if (e.target.id === "bot-count") S.botCount = Number(e.target.value);
});
document.addEventListener("change", (e) => {
  if (e.target.id === "bot-count") S.botCount = Number(e.target.value);
  if (e.target.id === "no-turn-timer") S.noTurnTimer = e.target.checked;
  if (["allow-nope-chain", "include-imploding", "include-reverse"].includes(e.target.id)) {
    S[{"allow-nope-chain":"allowNopeChain", "include-imploding":"includeImploding", "include-reverse":"includeReverse"}[e.target.id]] = e.target.checked;
    render();
  }
  if (e.target.id === "bot-nope") S.respondNope = e.target.checked;
  if (["reduced", "sound"].includes(e.target.id)) {
    S.settings[e.target.id] = e.target.checked;
    localStorage.setItem("boom.settings", JSON.stringify(S.settings));
    document.body.classList.toggle("reduced", S.settings.reduced);
  document.body.classList.toggle("home-page", !S.room);
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled || S.busy) return;
  const a = b.dataset.action;
  try {
    if (["nope-response", "nope-pass", "nope"].includes(a)) {
      const response = U.nopeResponse(S.room, Date.now() + S.clockOffset);
      if (!(a === "nope-pass" ? response?.canPass : response?.canNope) || (a !== "nope" && b.dataset.window !== response.key)) {
        countdown();
        toast("响应窗口已变化，请查看当前提示");
        return;
      }
      if (a === "nope-pass") return await cmd("passNope", { nopeCount: response.nopeCount, nopeWindow: response.key });
      return await cmd("nope", { cardId: response.cardId, nopeCount: response.nopeCount, nopeWindow: response.key });
    }
    if (a === "nope-time") {
      const seconds = Number(b.dataset.seconds);
      if ([10, 20, 30, 0].includes(seconds)) S.nopeSeconds = seconds;
      render();
      return;
    }
    if (a === "close-room") {
      if (U.derive(S.room, S.selected).isHost) S.modal = "close-room";
      render();
      return;
    }
    if (a === "close-room-submit") {
      if (S.modal === "close-room" && U.derive(S.room, S.selected).isHost) return await cmd("closeRoom");
      return;
    }
    if (a === "create") {
      S.noTurnTimer = false;
      S.nopeSeconds = 10;
      S.allowNopeChain = true;
      S.includeImploding = true;
      S.includeReverse = true;
      S.modal = "create";
      render();
      return;
    }
    if (a === "bots") {
      if (!U.derive(S.room, [], S.localMode).canAddBots) return;
      S.botCount = 1;
      S.respondNope = false;
      S.modal = "bots";
      render();
      return;
    }
    if (a === "bots-submit") return await addBots();
    if (
      ["settings", "profile", "join", "rules", "leave", "detail"].includes(a)
    ) {
      S.modal = a;
      render();
      if (a === "join") $("#code")?.focus();
      return;
    }
    if (a === "close") {
      S.modal = null;
      render();
      return;
    }
    if (a === "avatar") {
      S.avatar = Number(b.dataset.id);
      localStorage.setItem("boom.avatar", S.avatar);
      S.modal = null;
      render();
      return;
    }
    if (a === "create-submit" || a === "join-submit") {
      S.busy = true;
      const code = $("#code")?.value.trim();
      await session();
      accept(
        await api(
          a === "create-submit" ? "/rooms" : "/rooms/join",
          a === "create-submit" ? { noTurnTimer: S.noTurnTimer, nopeSeconds: S.nopeSeconds, allowNopeChain: S.allowNopeChain, includeImploding: S.includeImploding, includeReverse: S.includeReverse } : { code },
        ),
      );
      S.modal = null;
      render();
      poll();
      S.busy = false;
      render();
      return;
    }
    if (a === "resume") {
      const r = await api("/rooms/current");
      if (r) {
        S.resume = false;
        accept(r);
        poll();
      } else {
        S.resume = false;
        render();
      }
      return;
    }
    if (a === "copy" || a === "invite") {
      const text = S.room.code;
      if (a === "invite" && navigator.share) {
        try {
          await navigator.share({
            title: "来玩炸毛猫咪",
            text: "来朋友局玩炸毛猫咪，房间号 " + text,
            url: location.origin + "/?room=" + text,
          });
        } catch (e) {
          if (e.name !== "AbortError") throw e;
        }
      } else {
        await navigator.clipboard.writeText(text);
        toast("房间号已复制，发给朋友吧");
      }
      return;
    }
    if (a === "card") {
      let id = b.dataset.id;
      S.selected = S.selected.includes(id)
        ? S.selected.filter((x) => x !== id)
        : [...S.selected, id];
      render();
      return;
    }
    if (a === "hand-toggle") {
      S.handExpanded = !S.handExpanded;
      render();
      if ($(".hand")) $(".hand").scrollLeft = 0;
      return;
    }
    if (a === "clear") {
      S.selected = [];
      render();
      return;
    }
    if (a === "prepare") {
      if (!U.selection(S.room, S.selected).valid) return;
      S.target = "";
      S.modal = "play";
      render();
      return;
    }
    if (a === "target") {
      if (!U.derive(S.room, S.selected).targets.some(p => p.id === b.dataset.id)) return;
      S.target = b.dataset.id;
      render();
      return;
    }
    if (a === "play") {
      const v = U.derive(S.room, S.selected);
      if (!v.selection.valid || (v.selection.needsTarget && !v.targets.some(p => p.id === S.target)) || (v.selection.needsNamed && !v.namedOptions.some(c => c.value === S.named))) return;
      await cmd("play", {
        cards: S.selected,
        target: S.target || undefined,
        named: U.selection(S.room, S.selected).needsNamed ? S.named : undefined,
      });
      return;
    }
    if (a === "ready")
      return await cmd("ready", { ready: !U.derive(S.room, []).ready });
    if (a === "kick") {
      if (confirm("将这位朋友移出房间？"))
        await cmd("kick", { target: b.dataset.id });
      return;
    }
    if (a === "future-up" || a === "future-down") {
      S.futureState = U.moveFuture(S.room, S.futureState, b.dataset.id, a === "future-up" ? -1 : 1);
      render();
      return;
    }
    if (a === "orderFuture") {
      S.futureState = U.futureOrder(S.room, S.futureState);
      if (S.futureState?.canConfirm) return await cmd("orderFuture", { order: [...S.futureState.order] });
      return;
    }
    if (a === "give") return await cmd("give", { cardId: S.selected[0] });
    if (a === "insert") return await cmd("insert", { position: S.position });
    if (a === "leave-submit") return await cmd("leave");
    if (a === "draw" && !U.derive(S.room, S.selected).canDraw) return;
    if (["draw", "defuse", "closeFuture", "start", "rematch"].includes(a))
      await cmd(a);
  } catch (e) {
    S.busy = false;
    render();
    toast(e.message);
  }
});
async function boot() {
  render();
  try {
    const health = await api("/health");
    S.localMode = health.ok === true && ["local", "preview"].includes(health.mode);
    render();
  } catch {
    S.localMode = false;
  }
  if (S.token) {
    try {
      const r = await api("/rooms/current");
      if (r?.code) {
        accept(r);
        poll();
      }
    } catch (e) {
      if (e.status === 401) {
        S.token = null;
        sessionStorage.removeItem("boom.token");
      } else {
        S.error = e.message;
        render();
      }
    }
  }
  const invite = new URLSearchParams(location.search).get("room");
  if (invite && !S.room) {
    S.modal = "join";
    render();
    $("#code").value = invite;
  }
}
boot();
