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
  busy: false,
  error: "",
  connection: "",
  settings: JSON.parse(
    localStorage.getItem("boom.settings") || '{"reduced":false,"sound":false}',
  ),
  poll: 0,
  clockOffset: 0,
};
function avatar(p, cls = "") {
  let a = U.avatars[Number(p.avatar ?? p.id) % 4] || U.avatars[0];
  return `<div class="avatar ${cls}"><img src="/ui.jpg" alt="${esc(a.name)}猫" style="${a.style}"></div>`;
}
function card(c, select = false) {
  c = U.card(c);
  return `<${select ? "button" : "div"} class="card ${S.selected.includes(c.id) ? "selected" : ""}" ${select ? `data-action="card" data-id="${esc(c.id)}" aria-pressed="${S.selected.includes(c.id)}" aria-label="${esc(c.name)}，${esc(c.description)}"` : ""}><div class="card-art"><img alt="" src="/${c.source}" style="${c.art}"></div><strong>${esc(c.name)}</strong><small>${esc(c.short)}</small></${select ? "button" : "div"}>`;
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
  const old = S.room;
  if (old?.code === r.code && old.revision > r.revision) return;
  S.room = r;
  S.clockOffset = r.serverNow - Date.now();
  S.selected = S.selected.filter((id) => r.game?.hand.some((c) => c.id === id));
  if (U.contextChanged(old, r)) {
    S.modal = null;
    S.target = "";
    S.position = 1;
    if (S.settings.sound) tone();
  }
  const effect = U.motion(old, r);
  if (effect) {
    S.motion = effect;
    clearTimeout(S.motionTimer);
    S.motionTimer = setTimeout(() => {
      S.motion = null;
      document.querySelector(".motion-layer")?.remove();
    }, 850);
  }
  render();
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
async function cmd(type, payload = {}) {
  if (S.busy || !S.room) return;
  S.busy = true;
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
      S.poll++;
      S.resume = !!r;
      S.room = null;
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
      toast("局面已变化，请查看最新状态后再操作");
    } else toast(e.message);
  } finally {
    S.busy = false;
    render();
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
      if ([401, 403, 404].includes(e.status)) {
        S.poll++;
        S.room = null;
        S.modal = null;
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
  return `<div class="top"><div><div class="eyebrow">BOOMCAT · 和朋友一起</div><h1>朋友局</h1><p class="subtitle">和朋友，轻松开一局</p></div>${btn("⚙", "settings", "circle")}</div><div class="hero" role="img" aria-label="可爱的白色猫咪抱着炸弹，前方摆着拆弹、攻击和跳过卡牌"><img src="/ui.jpg" alt=""></div><div class="identity">${btn(avatar({ avatar: S.avatar }), "profile", "avatar pick")}<input id="name" aria-label="你的昵称" maxlength="12" placeholder="给自己起个名字" value="${esc(S.name)}"></div>${S.resume ? btn("返回正在进行的对局", "resume") : ""}${btn("创建房间", "create")}${btn("加入房间", "join", "secondary")}<div class="center space">${btn("玩法说明 ›", "rules", "text-btn")}</div><div class="center space muted small">2–5 人 · 私人好友房 · 最后存活的猫咪获胜</div>`;
}
function waiting(r, v) {
  return `<div class="top">${btn("‹", "leave", "circle")}<h2>好友房</h2>${btn("⚙", "settings", "circle")}</div><div class="code"><span class="muted">房间号</span><strong>${esc(r.code)}</strong>${btn("复制房间号 ↗", "copy", "text-btn")}<p class="muted">把房间号分享给朋友，一起来玩吧！</p></div><div class="seats">${v.players.map((p) => `<div class="seat">${avatar(p)}<strong>${esc(p.name)}${p.isMe ? " · 你" : ""}</strong><span class="${p.ready ? "ready" : "muted"}">${p.ready ? "✓ 已准备" : "◌ 等待准备"}${p.isHost ? " · 房主" : ""}</span>${v.isHost && !p.isMe ? btn("移出", "kick", "remove", false, `data-id="${esc(p.id)}"`) : ""}</div>`).join("")}${Array.from({ length: Math.max(0, 2 - v.players.length) }, () => '<div class="seat"><div class="avatar center" style="font-size:40px;padding-top:14px;color:#aab9c9">＋</div><span class="muted">等一位朋友</span></div>').join("")}</div>${btn("邀请朋友", "invite", "secondary")}${btn(v.ready ? "取消准备" : "我准备好了", "ready", v.isHost ? "secondary" : "primary")}${v.isHost ? btn("开始游戏", "start", "primary", !v.canStart) : '<p class="center muted space">大家准备后，由房主开始游戏</p>'}<p class="center muted small space">${r.players.length}/5 人 · 每人 8 张起手牌</p>`;
}
function game(r, v) {
  const g = r.game;
  return `<div class="top">${btn("‹", "leave", "circle")}<div class="roomtitle"><h2>炸弹猫</h2><p class="muted">房间号 ${esc(r.code)}</p></div>${btn("⚙", "settings", "circle")}</div><div class="opponents">${v.players.map((p) => `<div class="opponent ${p.active ? "active" : ""} ${!p.alive ? "out" : ""}">${avatar(p)}<strong>${esc(p.name)}${p.isMe ? " · 你" : ""}</strong><span class="tag">${p.alive ? `${p.count} 张牌` : "已出局"}</span></div>`).join("")}</div>${g.phase === "finished" ? `<div class="winner">${avatar(v.players.find((p) => p.id === g.winner) || { avatar: 0 })}<h1 style="font-size:32px">${esc(v.winnerName)}获胜</h1><p class="muted space">这一次，幸运站在你这边。</p>${v.isHost ? btn("再来一局", "rematch") : '<p class="muted space">等待房主再开一局</p>'}${btn("返回大厅", "leave", "secondary")}</div>` : `<div class="table center"><div class="turn-label"><strong>${esc(v.phaseTitle)}</strong><span>${g.remaining} 个回合</span><span data-countdown></span></div><div class="piles"><div class="pile"><div class="card-back">🐾</div>牌堆 · ${g.deckCount} 张</div><div class="pile">${v.discard ? `<div class="empty-pile" style="background:white;border-style:solid"><strong>${esc(v.discard.name)}</strong></div>` : '<div class="empty-pile">暂无出牌</div>'}弃牌堆</div></div></div>${phase(r, v)}${!v.alive ? '<div class="notice">你已出局，正在旁观。你的手牌只对自己可见。</div>' : ""}<div class="hand-caption"><span>你的手牌 ${g.hand.length} 张 · 左右滑动</span>${btn("取消选择", "clear", "text-btn", !S.selected.length)}</div><div class="hand">${g.hand.map((c) => card(c, true)).join("")}</div><div class="selection">${esc(v.selection.hint)}${S.selected.length === 1 ? btn("查看卡牌详情", "detail", "text-btn") : ""}</div><div class="action-bar">${v.canGive ? btn("交出选中的牌", "give") : ""}${v.selection.valid ? btn("出牌" + (S.selected.length > 1 ? ` · ${S.selected.length} 张组合` : ""), "prepare") : ""}${v.canNope ? btn("否定这个效果", "nope") : ""}${v.canDraw ? btn(g.attacked ? "抽牌，完成 1 个回合" : "抽牌并结束本回合", "draw", S.selected.length ? "secondary" : "primary") : ""}</div>`}<div class="logs"><p>对局动态</p>${(
    g.privateLog || []
  )
    .slice(-3)
    .map((l) => `<p class="private-log">仅你可见 · ${esc(l.text)}</p>`)
    .join("")}${(g.logs || [])
    .slice(-5)
    .map((l) => `<p>${esc(l.text)}</p>`)
    .join("")}</div>`;
}
function phase(r, v) {
  let g = r.game;
  if (g.phase === "nope")
    return `<div class="phase"><h3>${esc(v.pendingName)} · 等待响应</h3>${g.pending?.nopeCount % 2 ? "当前将被取消" : "当前将会生效"} · 已否定 ${g.pending?.nopeCount || 0} 次<p class="muted">任何存活玩家都可以使用否定。</p></div>`;
  if (g.phase === "future" && g.future)
    return `<div class="phase"><h3>悄悄看，只有你知道</h3><p>从左到右，第一张是下一次会抽到的牌。</p><div class="future">${g.future.map((c, i) => `<div><p class="small muted center">第 ${i + 1} 张</p>${card(c)}</div>`).join("")}</div>${btn("看好了，继续", "closeFuture")}</div>`;
  if (g.phase === "favor" && g.pending?.target === v.myId)
    return '<div class="phase"><h3>送出一张牌</h3>请在手牌中只选择一张，再点击交出。</div>';
  if (g.phase === "defuse" && v.turn)
    return `<div class="phase"><h3>抽到炸弹猫了！</h3>用拆弹稳稳保命，再秘密放回炸弹。${btn("使用拆弹", "defuse")}</div>`;
  if (g.phase === "insert" && v.turn)
    return `<div class="phase"><h3>秘密放回炸弹</h3><p>位置只有你知道，其他牌的顺序不会改变。</p><label for="position">选择插入位置</label><select id="position">${v.positions.map((p) => `<option value="${p.value}" ${S.position === p.value ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>${btn("确认放回", "insert")}</div>`;
  return "";
}
function modal() {
  if (!S.modal) return "";
  let body = "",
    title = "";
  let v = U.derive(S.room, S.selected);
  switch (S.modal) {
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
      body = `<ol><li>2–5 位朋友，每人 8 张牌，至少有 1 张拆弹。</li><li>轮到你，可以先出牌，再抽一张结束回合。抽到炸弹，拆弹保命；没有拆弹则出局。</li><li>攻击把回合转给下家，跳过免抽一次。预知、索要、洗牌用完仍需继续行动。</li><li>出牌后有 5 秒否定窗口，否定也能被否定。</li><li>两张同名随机拿对方一张牌；三张同名指定想要的牌名，没有则落空。</li><li>超时会自动抽牌、拆弹或完成必选操作；断线不暂停整桌。</li></ol><p>拆弹后的炸弹可放在牌堆任意位置，只有你知道。最后一只存活的猫获胜。</p>`;
      break;
    case "play":
      title = "确认出牌";
      body = `<p>${esc(v.selection.hint)}</p>${v.selection.needsTarget ? `<label>选择一位对手</label><div class="target-grid">${v.targets.map((p) => btn(avatar(p) + esc(p.name), "target", "target-option " + (S.target === p.id ? "chosen" : ""), false, `data-id="${esc(p.id)}"`)).join("")}</div>` : ""}${
        v.selection.needsNamed
          ? `<label for="named">声明想要的牌名</label><select id="named">${Object.entries(
              U.names,
            )
              .filter(([k]) => k !== "bomb")
              .map(
                ([k, n]) =>
                  `<option value="${k}" ${k === S.named ? "selected" : ""}>${n}</option>`,
              )
              .join("")}</select>`
          : ""
      }${btn("确认打出", "play", "primary", !v.selection.valid || (v.selection.needsTarget && !S.target))}`;
      break;
    case "leave":
      title = S.room?.status === "playing" ? "暂时离开这一局？" : "离开房间？";
      body = `<p>${S.room?.status === "playing" ? "你的席位将由系统托管到本局结束。回来后可继续原局，期间不能加入其他房间。" : "离开后可以重新创建或加入朋友的房间。"}</p>${btn("确认离开", "leave-submit")}`;
      break;
  }
  return `<div class="overlay-screen"><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="top"><h2>${title}</h2>${btn("×", "close", "circle")}</div>${body}</section></div>`;
}
function render() {
  document.body.classList.toggle("reduced", S.settings.reduced);
  const r = S.room,
    v = U.derive(r, S.selected);
  $("#app").innerHTML =
    `<div class="shell">${!r ? lobby() : r.status === "aborted" ? `<h2>这局已中止</h2><p class="muted space">房间已结束，请返回大厅重新开局。</p>${btn("回大厅", "leave-submit")}` : r.game ? game(r, v) : waiting(r, v)}${S.error ? `<p class="error" role="alert">${esc(S.error)}</p>` : ""}<p class="connections center space">${esc(S.connection)}</p></div>${modal()}${S.motion && !S.settings.reduced ? `<div class="motion-layer ${S.motion.kind}" aria-hidden="true"><div class="motion-tile">${S.motion.card ? card(S.motion.card) : "◉"}<strong>${esc(S.motion.title)}</strong></div></div>` : ""}`;
  countdown();
}
function countdown() {
  const node = $("[data-countdown]");
  if (node && S.room?.game?.deadline)
    node.textContent =
      Math.max(
        0,
        Math.ceil((S.room.game.deadline - Date.now() - S.clockOffset) / 1000),
      ) + "s";
}
setInterval(countdown, 250);
document.addEventListener("input", (e) => {
  if (e.target.id === "name") S.name = e.target.value;
  if (e.target.id === "position") S.position = Number(e.target.value);
  if (e.target.id === "named") S.named = e.target.value;
});
document.addEventListener("change", (e) => {
  if (["reduced", "sound"].includes(e.target.id)) {
    S.settings[e.target.id] = e.target.checked;
    localStorage.setItem("boom.settings", JSON.stringify(S.settings));
    document.body.classList.toggle("reduced", S.settings.reduced);
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled) return;
  const a = b.dataset.action;
  try {
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
    if (a === "create" || a === "join-submit") {
      S.busy = true;
      const code = $("#code")?.value.trim();
      await session();
      accept(
        await api(
          a === "create" ? "/rooms" : "/rooms/join",
          a === "create" ? {} : { code },
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
            title: "来玩炸弹猫",
            text: "来朋友局玩炸弹猫，房间号 " + text,
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
    if (a === "clear") {
      S.selected = [];
      render();
      return;
    }
    if (a === "prepare") {
      S.target = "";
      S.modal = "play";
      render();
      return;
    }
    if (a === "target") {
      S.target = b.dataset.id;
      render();
      return;
    }
    if (a === "play") {
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
    if (a === "nope")
      return await cmd("nope", {
        cardId: S.room.game.hand.find((c) => c.type === "nope").id,
      });
    if (a === "give") return await cmd("give", { cardId: S.selected[0] });
    if (a === "insert") return await cmd("insert", { position: S.position });
    if (a === "leave-submit") return await cmd("leave");
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
