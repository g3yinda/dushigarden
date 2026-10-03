const U = require("./controller");
const Choices = require("./game-choice-ui");
const C = {
  bg: "#f5f5f7",
  white: "#ffffff",
  ink: "#1d1d1f",
  muted: "#697281",
  line: "#e3e3e8",
  blue: "#0071e3",
  pale: "#eaf3ff",
  red: "#d9182b",
};
const TONES = {
  cat: "#efe7fa",
  defuse: "#e6f3e2",
  nope: "#fce5e8",
  attack: "#fff0d8",
  other: "#e6f1fc",
  bomb: "#f1b4b9",
};
const RULES = [
  "① 2–6 位朋友，每人 8 张牌，至少有 1 张拆弹。2–5 人用基础版，6 人加入完整内爆猫扩展。",
  "② 轮到你，可以先出牌，再抽一张结束回合。抽到炸弹，拆弹保命；没有拆弹则出局。",
  "③ 攻击把回合转给下家，跳过免抽一次。预知、索要、洗牌用完仍需继续行动。",
  "④ 否定时长可选10、20、30秒或不限时，默认10秒。开启“可循环否定”后可反否定，每层独立响应。",
  "⑤ 两张同名随机拿对方一张牌；三张同名指定想要的牌名，没有则落空。",
  "⑥ 拆弹后可秘密放在任意位置，最后存活的猫咪获胜。",
  "⑦ 超时会自动抽牌、拆弹或完成必选操作。断线不暂停整桌，回来可接管后续操作。",
  "六人扩展：内爆猫首次翻面秘密插回，再抽到直接出局且不能拆弹。定向攻击可选自己；反转改变方向并免抽一个回合；抽牌底从底部抽牌；调整未来秘密重排前三张。野猫只替代普通猫组成组合。",
];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function inside(r, x, y) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function intersection(a, b) {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    w = Math.min(a.x + a.w, b.x + b.w) - x,
    h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
/** Canvas2D view in logical pixels. The host sizes the backing canvas to window×DPR;
 * render resets the transform to DPR each frame. Business state stays on page.data.
 * layout exposes the current visible interaction geometry for accessibility/debugging.
 */
class CanvasUI {
  constructor({ canvas, wx, page, info, onInput, onInvalidate, share }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.wx = wx;
    this.page = page;
    this.onInput = onInput || (() => {});
    this.onInvalidate = onInvalidate;
    this.share = share;
    this.images = new Map();
    this.pageScroll = 0;
    this.modalScroll = 0;
    this.handOffset = 0;
    this.picker = null;
    this.destroyed = false;
    this.imageDirty = false;
    this.resize(info);
    for (const name of ["ui.jpg", "core.jpg", "cats.jpg", "expansion.jpg"])
      this.image(name);
  }
  resize(info) {
    this.info = info || this.info || {};
    this.w = this.info.windowWidth || 390;
    this.h = this.info.windowHeight || 844;
    this.dpr = this.info.pixelRatio || 1;
    const menuBottom = Number(this.info.menu?.bottom);
    this.top = Math.max(
      12,
      (this.info.statusBarHeight || 0) + 44,
      Number.isFinite(menuBottom) ? menuBottom + 8 : 0,
    );
    this.bottom = Math.max(16, this.h - (this.info.safeArea?.bottom ?? this.h));
    this.pageScroll = 0;
    this.modalScroll = 0;
  }
  image(name) {
    if (this.images.has(name)) return this.images.get(name);
    const factory = this.wx.createImage
      ? () => this.wx.createImage()
      : this.canvas.createImage
        ? () => this.canvas.createImage()
        : null;
    if (!factory) return null;
    const image = factory();
    const entry = { image, ready: false, error: false };
    this.images.set(name, entry);
    image.onload = () => {
      entry.ready = true;
      this.imageDirty = true;
      this.invalidate();
    };
    image.onerror = () => {
      entry.error = true;
      this.imageDirty = true;
      this.invalidate();
    };
    image.src = "assets/" + name;
    return entry;
  }
  path(x, y, w, h, r = 16) {
    const c = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  box(x, y, w, h, fill = C.white, stroke = null, r = 16) {
    this.path(x, y, w, h, r);
    const c = this.ctx;
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  font(size = 15, weight = 400) {
    this.ctx.font = `${weight} ${size}px system-ui, -apple-system, 'PingFang SC', sans-serif`;
  }
  text(
    text,
    x,
    y,
    size = 15,
    color = C.ink,
    align = "left",
    weight = 400,
    maxWidth,
  ) {
    this.font(size, weight);
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = "middle";
    let s = String(text ?? "");
    if (maxWidth) {
      while (s.length > 1 && this.ctx.measureText(s).width > maxWidth)
        s = s.slice(0, -2) + "…";
    }
    this.ctx.fillText(s, x, y);
  }
  lines(value, width, size = 14) {
    this.font(size);
    const result = [];
    for (const paragraph of String(value ?? "").split("\n")) {
      let line = "";
      for (const ch of Array.from(paragraph)) {
        if (line && this.ctx.measureText(line + ch).width > width) {
          result.push(line);
          line = ch;
        } else line += ch;
      }
      result.push(line);
    }
    return result;
  }
  paragraph(
    value,
    x,
    y,
    width,
    size = 14,
    color = C.muted,
    lineHeight = size * 1.55,
  ) {
    const lines = this.lines(value, width, size);
    lines.forEach((s, i) =>
      this.text(s, x, y + lineHeight / 2 + i * lineHeight, size, color),
    );
    return y + lines.length * lineHeight;
  }
  clip(rect, fn) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(rect.x, rect.y, rect.w, rect.h);
    this.ctx.clip();
    const old = this.clipRect;
    // Preserve an empty parent/child intersection; null means no active clip.
    this.clipRect = old
      ? intersection(old, rect) || { x: 0, y: 0, w: 0, h: 0 }
      : rect;
    fn();
    this.clipRect = old;
    this.ctx.restore();
  }
  region(action, x, y, w, h, extra = {}) {
    let r = { x, y, w, h, action, ...extra };
    if (this.clipRect) {
      const hit = intersection(r, this.clipRect);
      if (!hit) return;
      r = { ...r, ...hit };
    }
    const visible = intersection(r, { x: 0, y: 0, w: this.w, h: this.h });
    if (visible) this.layout.regions.push({ ...r, ...visible });
  }
  button(label, action, x, y, w, h = 48, opts = {}) {
    const disabled = !!opts.disabled || !!this.page.data.busy;
    const primary = opts.primary;
    const danger = opts.danger;
    const bg = disabled
      ? primary
        ? "#d6e8fb"
        : "#f0f0f2"
      : primary
        ? danger
          ? C.red
          : C.blue
        : opts.pill
          ? C.pale
          : C.white;
    const color = disabled
      ? "#959aa2"
      : primary
        ? C.white
        : danger
          ? C.red
          : C.blue;
    this.box(
      x,
      y,
      w,
      h,
      bg,
      primary || opts.pill
        ? null
        : disabled
          ? C.line
          : danger
            ? "#f1b4b9"
            : C.blue,
      h / 2,
    );
    this.text(
      label,
      x + w / 2,
      y + h / 2,
      opts.size || 16,
      color,
      "center",
      600,
      w - 12,
    );
    this.region(action, x, y, w, h, { ...opts, disabled });
  }
  pill(label, action, x, y, w, extra = {}) {
    this.box(x, y + 8, w, 28, C.pale, null, 14);
    this.text(label, x + w / 2, y + 22, 12, C.blue, "center", 600, w - 8);
    this.region(action, x, y, w, 44, {
      ...extra,
      disabled: !!this.page.data.busy,
    });
  }
  crop(name, sx, sy, sw, sh, x, y, w, h, r = 0) {
    const entry = this.image(name);
    if (!entry?.ready) return false;
    this.ctx.save();
    if (r) {
      this.path(x, y, w, h, r);
      this.ctx.clip();
    }
    this.ctx.drawImage(entry.image, sx, sy, sw, sh, x, y, w, h);
    this.ctx.restore();
    return true;
  }
  avatar(p, x, y, size = 48, active = false) {
    this.ctx.save();
    if (p?.alive === false) this.ctx.globalAlpha = 0.45;
    this.box(x, y, size, size, "#fff6e8", active ? C.blue : C.line, size / 2);
    const id = Number(p?.avatar ?? p?.id ?? 0) % 4;
    const style = p?.avatarStyle || U.avatars[id]?.style || U.avatars[0].style;
    const pct = (k) =>
      Number(style.match(new RegExp(k + ":(-?[\\d.]+)%"))?.[1] || 0);
    const width = pct("width");
    const image = this.image("ui.jpg");
    if (image?.ready && width > 0) {
      const iw = image.image.width || 1536,
        scale = (size * width) / 100 / iw;
      const sx = (-pct("left") * size) / 100 / scale,
        sy = (-pct("top") * size) / 100 / scale;
      this.crop(
        "ui.jpg",
        sx,
        sy,
        size / scale,
        size / scale,
        x + 2,
        y + 2,
        size - 4,
        size - 4,
        size / 2,
      );
    } else
      this.text("🐱", x + size / 2, y + size / 2, size * 0.55, C.ink, "center");
    this.ctx.restore();
  }
  cardArt(card, x, y, w, h) {
    const style = card.handArt || U.card(card).handArt;
    const width = Number(style.match(/width:([\d.]+)%/)?.[1]);
    const left = Number(style.match(/left:(-?[\d.]+)%/)?.[1]);
    const ty = Number(style.match(/translateY\(-([\d.]+)%\)/)?.[1]);
    const entry = this.image(card.source || U.card(card).source);
    if (!entry?.ready || !width) return;
    const iw = entry.image.width || 1536,
      ih = entry.image.height || 1024;
    const sw = (iw * 100) / width,
      sh = sw / (card.handRatio || U.card(card).handRatio);
    const sx = (-left * sw) / 100,
      sy = ((ty || 0) * ih) / 100;
    const scale = Math.max(w / sw, h / sh);
    const cw = w / scale,
      ch = h / scale;
    this.crop(
      card.source || U.card(card).source,
      sx + (sw - cw) / 2,
      sy + (sh - ch) / 2,
      cw,
      ch,
      x,
      y,
      w,
      h,
      8,
    );
  }
  card(raw, x, y, w = 112, h = 136, { hand = false, selected = false } = {}) {
    const card = raw.name ? raw : U.card(raw);
    const tone = TONES[card.spineTone] || TONES.other;
    this.box(
      x,
      y,
      w,
      h,
      card.type === "bomb" ? "#fff1f2" : C.white,
      selected ? C.blue : C.line,
      14,
    );
    if (selected) {
      this.ctx.lineWidth = 2;
      this.path(x + 1, y + 1, w - 2, h - 2, 13);
      this.ctx.strokeStyle = C.blue;
      this.ctx.stroke();
    }
    const spine = hand ? 26 : 0;
    if (hand) {
      this.box(x + 3, y + 6, 23, h - 12, tone, null, 9);
      let name = card.name.replace(/ ×/g, "");
      const spineStep = Math.min(
        15,
        (h - 24) / Math.max(1, Array.from(name).length - 1),
      );
      Array.from(name).forEach((ch, i) =>
        this.text(
          ch,
          x + 14,
          y + 15 + i * spineStep,
          Math.min(14, spineStep + 1),
          card.type === "bomb" ? C.red : C.ink,
          "center",
          600,
        ),
      );
    }
    const small = h < 100;
    const artH =
      card.compactHand && hand
        ? Math.min(58, h * 0.44)
        : Math.max(28, h * (small ? 0.44 : 0.53));
    this.cardArt(card, x + spine + 5, y + 6, w - spine - 10, artH);
    if (card.symbol)
      this.text(card.symbol, x + w - 13, y + 16, 15, C.blue, "center", 600);
    this.text(
      card.name,
      x + spine + 7,
      y + artH + 19,
      hand ? 13 : small ? 10 : 14,
      card.type === "bomb" ? C.red : C.ink,
      "left",
      600,
      w - spine - 14,
    );
    const shortSize = small ? 9 : hand ? 10 : 11;
    const shortLines = this.lines(card.short, w - spine - 13, shortSize);
    const maxLines = Math.max(1, Math.floor((h - artH - 24) / 12));
    shortLines
      .slice(0, maxLines)
      .forEach((line, i) =>
        this.text(
          line,
          x + spine + 7,
          y + artH + 34 + i * 12,
          shortSize,
          C.muted,
        ),
      );
    if (card.stateLabel)
      this.text(
        card.stateLabel,
        x + w / 2,
        y + artH - 4,
        10,
        card.faceUp ? C.red : C.blue,
        "center",
        600,
      );
    if (selected) {
      this.box(x + w - 23, y + 4, 19, 19, C.blue, null, 10);
      this.text("✓", x + w - 13.5, y + 13.5, 12, C.white, "center", 600);
    }
  }
  header(title, subtitle) {
    this.button("‹", "leave", 18, this.top, 44, 44, { pill: true, size: 28 });
    this.text(title, this.w / 2, this.top + 16, 22, C.ink, "center", 600);
    if (subtitle)
      this.text(subtitle, this.w / 2, this.top + 37, 11, C.muted, "center");
    this.button("⚙", "settings", this.w - 62, this.top, 44, 44, {
      pill: true,
      size: 22,
    });
  }
  render(now = Date.now()) {
    if (this.destroyed) return;
    this.now = now;
    this.imageDirty = false;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.w, this.h);
    this.clipRect = null;
    const d = this.page.data;
    const key =
      (d.room?.code || "home") + ":" + (d.room?.game?.id || "waiting");
    if (this.contextKey !== key) {
      this.contextKey = key;
      this.pageScroll = 0;
      this.handOffset = 0;
      this.picker = null;
    }
    if (
      this.picker &&
      (this.picker.parentModal !== (d.modal || "") ||
        this.picker.phase !== d.room?.game?.phase ||
        this.picker.current !== d.room?.game?.current)
    )
      this.picker = null;
    const effect = d.motionItems?.[0];
    if (
      effect &&
      !["draw", "future"].includes(effect.kind) &&
      this.motionKey !== (effect.renderId ?? effect)
    )
      this.pageScroll = 0;
    const modalKey = this.picker
      ? "picker"
      : d.modal || (Choices.phaseChoice(d) ? "phase-choice" : "");
    if (this.lastModal !== modalKey) {
      this.modalScroll = 0;
      if (modalKey === "play") this.choiceState = null;
      this.lastModal = modalKey;
    }
    if (this.lastExpanded !== d.handExpanded) {
      this.handOffset = 0;
      this.lastExpanded = d.handExpanded;
    }
    this.layout = {
      screen: d.room ? (d.room.game ? "game" : "waiting") : "home",
      regions: [],
      seats: [],
      modal: modalKey,
      scroll: { max: 0, offset: this.pageScroll },
    };
    if (!d.room) this.home();
    else if (d.room.status === "aborted") this.aborted();
    else if (!d.room.game) this.waiting();
    else this.game();
    if (
      this.layout.screen !== "home" &&
      this.pageScroll > (this.pageMax || 0)
    ) {
      this.pageScroll = this.pageMax || 0;
      return this.render(now);
    }
    if (d.connection) this.connection(d.connection);
    if (modalKey) {
      this.modal();
      if (this.modalScroll > (this.modalMax || 0)) {
        this.modalScroll = this.modalMax || 0;
        return this.render(now);
      }
    }
    this.drawPressed();
    return this.layout;
  }
  home() {
    const d = this.page.data,
      x = 18,
      w = this.w - 36;
    const footerY = this.h - this.bottom - 44;
    const actionsH = d.canResume ? 164 : 106;
    const identityY = footerY - 8 - actionsH - 12 - 52;
    const noteY = identityY - 20;
    const available = Math.max(10, noteY - this.top - 10);
    const ah = Math.min(available, w / 0.864),
      aw = ah * 0.864,
      ax = (this.w - aw) / 2,
      ay = this.top + (available - ah) / 2;
    this.box(ax, ay, aw, ah, "#fff5e5", null, 24);
    const entry = this.image("ui.jpg");
    if (entry?.ready) {
      const iw = entry.image.width || 1536,
        ih = entry.image.height || 1024,
        scale = (aw * 3.56381) / iw;
      this.crop(
        "ui.jpg",
        (aw * 0.12761) / scale,
        (ah * 0.408) / scale,
        aw / scale,
        ah / scale,
        ax,
        ay,
        aw,
        ah,
        24,
      );
    } else {
      this.text(
        "🐱",
        this.w / 2,
        ay + ah * 0.45,
        Math.min(90, ah * 0.4),
        C.ink,
        "center",
      );
      this.text("炸弹猫", this.w / 2, ay + ah * 0.75, 24, C.ink, "center", 600);
    }
    this.box(
      ax + aw * 0.045,
      ay + ah * 0.22,
      aw * 0.3,
      ah * 0.11,
      "#fff0cf",
      null,
      8,
    );
    this.text(
      "2–6 人",
      ax + aw * 0.195,
      ay + ah * 0.275,
      clamp(aw * 0.055, 11, 22),
      "#5b493a",
      "center",
      600,
    );
    this.text(
      "2–5 人基础版 · 6 人完整内爆猫扩展",
      this.w / 2,
      noteY,
      11,
      C.muted,
      "center",
    );
    this.avatar(
      { avatar: d.avatar, avatarStyle: d.avatarStyle },
      x,
      identityY,
      52,
    );
    this.region("profile", x, identityY, 52, 52);
    this.box(x + 64, identityY + 2, w - 64, 48, "#fafafc", C.line, 16);
    this.text(
      d.name || "给自己起个名字",
      x + 78,
      identityY + 26,
      16,
      d.name ? C.ink : C.muted,
      "left",
      400,
      w - 92,
    );
    this.region("input", x + 64, identityY + 2, w - 64, 48, { field: "name" });
    let y = identityY + 64;
    if (d.canResume) {
      this.button("返回正在进行的对局", "resume", x, y, w, 48, {
        primary: true,
      });
      y += 58;
    }
    this.button("创建房间", "create", x, y, w, 48, { primary: true });
    y += 58;
    this.button("加入房间", "join", x, y, w, 48);
    this.button("玩法说明 ›", "rules", this.w / 2 - 89, footerY, 130, 44, {
      pill: true,
      size: 14,
    });
    this.button("⚙", "settings", this.w / 2 + 45, footerY, 44, 44, {
      pill: true,
      size: 22,
    });
  }
  aborted() {
    this.text(
      "这局已中止",
      this.w / 2,
      this.top + 90,
      28,
      C.ink,
      "center",
      600,
    );
    this.text(
      "请返回大厅，重新和朋友开一局。",
      this.w / 2,
      this.top + 136,
      14,
      C.muted,
      "center",
    );
    this.button("回大厅", "leave-submit", 18, this.top + 176, this.w - 36, 48, {
      primary: true,
    });
  }
  waiting() {
    const d = this.page.data,
      v = d.v || {},
      r = d.room;
    this.header("好友房");
    const clip = {
      x: 0,
      y: this.top + 50,
      w: this.w,
      h: this.h - this.bottom - this.top - 50,
    };
    this.clip(clip, () => {
      let y = clip.y + 8 - this.pageScroll;
      this.text("房间号", this.w / 2, y + 12, 12, C.muted, "center");
      this.text(r.code, this.w / 2, y + 44, 36, C.ink, "center", 600);
      this.button("复制房间号 ↗", "copy", this.w / 2 - 90, y + 64, 180, 44, {
        pill: true,
        size: 13,
      });
      y += 116;
      const mode = `${v.rulesLabel} · ${v.noTurnTimer ? "∞ 出牌不限时" : "出牌 30 秒"} · 否定 ${v.nopeTimeLabel}`;
      y = this.paragraph(mode, 18, y, this.w - 36, 11, C.muted, 16) + 8;
      const ps = v.players || [];
      const cw = (this.w - 48) / 2,
        seatH = 98;
      ps.forEach((p, i) => {
        const sx = 18 + (i % 2) * (cw + 12),
          sy = y + Math.floor(i / 2) * seatH;
        this.box(sx, sy, cw, seatH - 8, C.white, C.line, 18);
        this.avatar(p, sx + 12, sy + 12, 40);
        this.text(
          p.name + (p.isMe ? " · 你" : ""),
          sx + 58,
          sy + 27,
          13,
          C.ink,
          "left",
          600,
          cw - 64,
        );
        this.text(
          p.ready ? "✓ 已准备" : "◌ 等待准备",
          sx + 12,
          sy + 68,
          12,
          p.ready ? "#348145" : C.muted,
        );
        if (p.isHost) this.text("房主", sx + 57, sy + 46, 10, C.muted);
        if (p.isBot) this.text("Bot", sx + 96, sy + 46, 10, C.muted);
        if (v.isHost && !p.isMe)
          this.button("移出", "kick", sx + cw - 52, sy + 46, 48, 44, {
            size: 11,
            id: p.id,
            pill: true,
          });
        this.layout.seats.push({ x: sx, y: sy, w: cw, h: seatH - 8, id: p.id });
      });
      if (ps.length < 2) {
        const sx = 18 + cw + 12;
        this.box(sx, y, cw, seatH - 8, C.white, C.line, 18);
        this.text("＋", sx + cw / 2, y + 26, 28, C.muted, "center");
        this.text("等一位朋友", sx + cw / 2, y + 66, 12, C.muted, "center");
      }
      y += Math.ceil(Math.max(2, ps.length) / 2) * seatH + 6;
      this.button("邀请朋友", "share", 18, y, this.w - 36, 48);
      y += 58;
      if (v.canAddBots) {
        this.button("添加验证 Bot", "bots", 18, y, this.w - 36, 48);
        y += 58;
      }
      this.button(
        v.ready ? "取消准备" : "我准备好了",
        "ready",
        18,
        y,
        this.w - 36,
        48,
        { primary: !v.isHost },
      );
      y += 58;
      if (v.isHost) {
        this.button("开始游戏", "start", 18, y, this.w - 36, 48, {
          primary: true,
          disabled: !v.canStart,
        });
        y += 58;
      } else {
        this.text(
          "大家准备后，由房主开始游戏",
          this.w / 2,
          y + 16,
          12,
          C.muted,
          "center",
        );
        y += 36;
      }
      this.text(
        `${r.players.length}/6 人 · 每人 8 张起手牌`,
        this.w / 2,
        y + 14,
        12,
        C.muted,
        "center",
      );
      y += 38;
      this.pageMax = Math.max(0, y + this.pageScroll - (clip.y + clip.h));
      this.layout.scroll = {
        max: this.pageMax,
        offset: this.pageScroll,
        viewport: clip,
      };
    });
    this.scrollIndicator(clip, this.pageScroll, this.pageMax);
  }
  game() {
    const d = this.page.data,
      v = d.v || {},
      g = d.room.game;
    this.header("炸弹猫", "房间号 " + d.room.code);
    const finished = g.phase === "finished";
    if (!finished) return this.activeGame();
    const dockH = finished ? 0 : 118;
    const dockY = this.h - this.bottom - dockH;
    const viewport = {
      x: 0,
      y: this.top + 54,
      w: this.w,
      h: dockY - this.top - 54,
    };
    const stageH = Math.max(
      300,
      Math.min(350, this.h - this.top - this.bottom - 118 - 220),
    );
    this.layout.dock = finished
      ? null
      : { x: 18, y: dockY, w: this.w - 36, h: dockH };
    this.clip(viewport, () => {
      let y = viewport.y - this.pageScroll;
      this.board(y, stageH);
      y += stageH + 8;
      if (v.deckTop || v.deckBottom) {
        for (const label of [
          v.deckTop ? "✹ 牌顶：翻面内爆猫 · 抽到即出局" : "",
          v.deckBottom ? "✹ 牌底：翻面内爆猫 · 抽到即出局" : "",
        ].filter(Boolean)) {
          y = this.paragraph(label, 22, y, this.w - 44, 12, C.red, 17) + 4;
        }
      }
      if (finished) {
        this.text(
          v.winnerName + "获胜",
          this.w / 2,
          y + 22,
          26,
          C.ink,
          "center",
          600,
        );
        this.text(
          "这一次，幸运站在你这边。",
          this.w / 2,
          y + 56,
          14,
          C.muted,
          "center",
        );
        y += 82;
        if (v.isHost) {
          this.button("再来一局", "rematch", 18, y, this.w - 36, 48, {
            primary: true,
          });
          y += 58;
        } else {
          this.text(
            "等待房主再开一局",
            this.w / 2,
            y + 22,
            14,
            C.muted,
            "center",
          );
          y += 48;
        }
        this.button("返回大厅", "leave", 18, y, this.w - 36, 48);
        y += 62;
      }
      const logs = [
        ...(g.privateLog || []).map((l) => "仅你可见 · " + l.text),
        ...(g.logs || []).map((l) => l.text),
      ];
      if (logs.length) {
        this.text("对局动态", 20, y + 14, 12, C.muted);
        y += 30;
        logs.forEach((s) => {
          y = this.paragraph(s, 20, y, this.w - 40, 12, C.muted, 18) + 6;
        });
      }
      y += 18;
      this.pageMax = Math.max(
        0,
        y + this.pageScroll - (viewport.y + viewport.h),
      );
      this.layout.scroll = {
        max: this.pageMax,
        offset: this.pageScroll,
        viewport,
      };
    });
    this.scrollIndicator(viewport, this.pageScroll, this.pageMax);
    if (!finished) this.dock(dockY);
    this.motion(d.motionItems || []);
  }
  activeGame() {
    const d = this.page.data,
      v = d.v,
      g = d.room.game;
    const dockY = this.h - this.bottom - 118;
    const top = this.top + 54;
    const available = dockY - top;
    const compact = available < 450;
    const handH = compact ? 142 : 204;
    const handY = dockY - handH - 6;
    const tableH = handY - top - 6;
    this.layout.dock = { x: 18, y: dockY, w: this.w - 36, h: 118 };
    this.board(top, tableH);
    const giving =
      v.alive && g.phase === "favor" && g.pending?.target === v.myId;
    this.pageMax = 0;
    this.pageScroll = 0;
    const viewport = {
      x: 18,
      y: top + 8,
      w: this.w - 36,
      h: Math.max(1, tableH - 16),
    };
    this.layout.scroll = { max: 0, offset: 0, viewport };
    this.layout.privatePanel = null;
    if (giving) this.box(12, handY, this.w - 24, handH - 1, null, C.blue, 18);
    if (tableH >= 260 && (v.deckTop || v.deckBottom))
      this.text(
        "✹ " + (v.deckTop ? "牌顶" : "牌底") + "有翻面内爆猫",
        this.w / 2,
        top + tableH - 62,
        10,
        C.red,
        "center",
        600,
        this.w - 100,
      );
    this.clip({ x: 0, y: handY, w: this.w, h: handH }, () => {
      this.hand(
        handY,
        compact ? { header: 36, width: 96, height: 90 } : undefined,
      );
      if (giving) {
        const actor = v.players.find((p) => p.id === g.pending?.actor);
        this.text(
          (actor?.name || "对方") + "索要 1 张 · 选牌后点交牌",
          this.w / 2,
          dockY - 17,
          10,
          C.blue,
          "center",
          600,
          this.w - 56,
        );
      }
      if (!giving && d.selected?.length && !v.selection?.valid && !v.canGive)
        this.text(
          v.selection?.hint || "",
          18,
          dockY - 14,
          10,
          C.muted,
          "left",
          400,
          this.w - 36,
        );
      if (!v.alive) this.text("已出局 · 旁观中", 18, dockY - 14, 10, C.muted);
    });
    this.dock(dockY);
    this.motion(d.motionItems || []);
  }
  board(y, h) {
    const d = this.page.data,
      v = d.v,
      g = d.room.game,
      x = 12,
      w = this.w - 24;
    this.layout.table = { x, y, w, h };
    this.box(x, y, w, h, "#faf8f4", null, 28);
    const c = this.ctx;
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, w * 0.42, h * 0.4, 0, 0, Math.PI * 2);
    c.fillStyle = "#f2ece2";
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = "#eadfcf";
    c.stroke();
    c.lineWidth = 1;
    const compact = h < 260;
    const timer = d.nopeInfo?.done
      ? "已响应"
      : d.countdown === null
        ? "∞"
        : (d.countdown || 0) + "s";
    const summary =
      g.phase === "finished"
        ? v.winnerName + "获胜"
        : `${v.phaseTitle} · ${g.remaining} 回合 · ${timer}`;
    (v.tablePlayers || []).forEach((p, i) => {
      const match = p.seatStyle?.match(
        /left:([\d.]+)%;top:clamp\(52px,([\d.]+)%/,
      );
      const px = match ? Number(match[1]) : 50,
        py = match ? Number(match[2]) : i ? 10 : 90;
      const sw = p.isMe ? 128 : 72,
        sh = p.isMe ? 40 : compact ? 52 : 82;
      const sx = clamp(x + (w * px) / 100 - sw / 2, x + 3, x + w - sw - 3);
      const sy = clamp(
        y + clamp((h * py) / 100, compact ? 30 : 52, h - 24) - sh / 2,
        y + 4,
        y + h - sh - 4,
      );
      const as = p.isMe ? (compact ? 32 : 40) : compact ? 28 : 44,
        ax = p.isMe ? sx : sx + (sw - as) / 2;
      this.avatar(p, ax, sy, as, p.active && g.phase !== "finished");
      if (p.isMe) {
        this.text(
          p.name + " · 你",
          sx + 48,
          sy + 16,
          12,
          C.ink,
          "left",
          600,
          sw - 48,
        );
        this.text(
          !p.alive
            ? "已出局"
            : compact
              ? `${v.phaseTitle}·${g.remaining}回合·${timer}`
              : p.count + " 张牌",
          sx + 48,
          sy + 34,
          compact ? 8 : 10,
          C.muted,
          "left",
          400,
          sw - 48,
        );
      } else {
        const labelY = sy + as + 3;
        this.box(sx, labelY, sw, compact ? 22 : 36, "#faf8f4", null, 10);
        this.text(
          p.name,
          sx + sw / 2,
          labelY + (compact ? 5 : 10),
          compact ? 9 : 11,
          C.ink,
          "center",
          600,
          sw - 6,
        );
        this.text(
          p.alive ? p.count + " 张牌" : "已出局",
          sx + sw / 2,
          labelY + (compact ? 17 : 26),
          compact ? 8 : 10,
          C.muted,
          "center",
        );
      }
      this.layout.seats.push({
        x: sx,
        y: sy,
        w: sw,
        h: sh,
        id: p.id,
        isMe: p.isMe,
      });
    });
    const cw = compact ? 48 : 74,
      ch = compact ? 40 : 100,
      centerY = y + (compact ? Math.max(57, 0.34 * h) : 0.32 * h),
      leftX = this.w / 2 - cw - 10,
      rightX = this.w / 2 + 10;
    const danger =
      compact && (v.deckTop ? "牌顶" : v.deckBottom ? "牌底" : null);
    this.box(
      leftX,
      centerY,
      cw,
      ch,
      danger ? "#fff1f2" : "#dceaff",
      danger ? C.red : C.blue,
      10,
    );
    this.text(
      compact && !danger ? "剩余" : "🐾",
      leftX + cw / 2,
      centerY + (compact ? 10 : ch / 2),
      compact && !danger ? 9 : danger ? 14 : 28,
      danger ? C.red : C.blue,
      "center",
    );
    if (compact)
      this.text(
        g.deckCount + " 张",
        leftX + cw / 2,
        centerY + ch - 10,
        danger ? 13 : 16,
        danger ? C.red : C.blue,
        "center",
        700,
      );
    if (!compact || danger)
      this.text(
        danger ? danger + "有内爆猫" : "剩余 " + g.deckCount + " 张",
        leftX + cw / 2,
        centerY + ch + (compact ? 4 : 12),
        danger ? 9 : compact ? 11 : 14,
        danger ? C.red : C.blue,
        "center",
        700,
        cw + 12,
      );
    if (v.discard && compact) {
      this.box(rightX, centerY, cw, ch, C.white, C.line, 10);
      this.cardArt(v.discard, rightX + 3, centerY + 3, cw - 6, ch - 6);
    } else if (v.discard) this.card(v.discard, rightX, centerY, cw, ch);
    else {
      this.box(rightX, centerY, cw, ch, null, C.line, 10);
      this.text(
        "出牌区",
        rightX + cw / 2,
        centerY + ch / 2,
        11,
        C.muted,
        "center",
      );
    }
    this.text(
      compact && v.discard ? v.discard.name : "弃牌堆",
      rightX + cw / 2,
      centerY + ch + (compact ? 5 : 12),
      compact ? 9 : 11,
      C.muted,
      "center",
    );
    if (!compact)
      this.text(
        summary,
        this.w / 2,
        centerY + ch + (compact ? 29 : 34),
        compact ? 10 : 12,
        C.blue,
        "center",
        600,
        w - 12,
      );
  }
  hand(y, sizing = {}) {
    const d = this.page.data,
      cards = d.v.hand || [],
      x = 18,
      w = this.w - 36;
    const giving =
      d.v.alive &&
      d.room.game.phase === "favor" &&
      d.room.game.pending?.target === d.v.myId;
    this.text("手牌 " + cards.length, x, y + 22, 16, C.ink, "left", 600);
    const toggleW = 86,
      clearW = 78;
    this.pill(
      d.handExpanded ? "收起手牌 ⌃" : "展开手牌 ⌄",
      "hand-toggle",
      this.w - 18 - toggleW - (d.selected.length ? clearW + 6 : 0),
      y,
      toggleW,
    );
    if (d.selected.length)
      this.pill("取消选择", "clear", this.w - 18 - clearW, y, clearW);
    if (d.selected.length === 1) this.pill("详情", "detail", x + 64, y, 44);
    y += sizing.header || 48;
    const cw = sizing.width || 112,
      ch = sizing.height || 136;
    const row = { x, y: y - 14, w, h: ch + 20 };
    let positions = [],
      next = 0;
    cards.forEach((card) => {
      positions.push(next);
      next += d.handExpanded || card.selected ? cw + 8 : 44;
    });
    const total = cards.length ? positions[positions.length - 1] + cw : 0;
    const max = Math.max(0, total - w);
    this.handOffset = clamp(this.handOffset, 0, max);
    this.layout.hand = {
      x,
      y,
      w,
      h: ch + 12,
      offset: this.handOffset,
      max,
      viewport: row,
      total,
      giving,
    };
    this.clip(row, () => {
      cards.forEach((card, i) => {
        const cx = x + positions[i] - this.handOffset,
          cy =
            y - (card.selected ? Math.min(12, (sizing.header || 48) - 36) : 0);
        this.card(card, cx, cy, cw, ch, {
          hand: true,
          selected: card.selected,
        });
        const hitW =
          i === cards.length - 1 ? cw : positions[i + 1] - positions[i];
        this.region("card", cx, cy, hitW, ch, { id: card.id, hand: true });
      });
      if (!cards.length)
        this.text("暂时没有手牌", this.w / 2, y + 50, 14, C.muted, "center");
    });
    const selectionHint =
      d.selected.length && !d.v.selection?.valid && !d.v.canGive;
    if (max > 0 && !selectionHint && !giving) {
      this.box(x, y + ch + 8, w, 3, "#e0e0e8", null, 2);
      this.box(
        x + (w - (w * w) / total) * (this.handOffset / max),
        y + ch + 8,
        (w * w) / total,
        3,
        "#9daac0",
        null,
        2,
      );
    }
    return y + ch + 22;
  }
  dock(y) {
    const d = this.page.data,
      v = d.v,
      n = d.nopeInfo || {},
      x = 18,
      w = this.w - 36;
    this.box(0, y - 6, this.w, this.h - y + 6, C.bg, null, 0);
    const urgent = n.canPass && !n.unlimited && n.remaining <= 3;
    this.box(
      x,
      y,
      w,
      56,
      n.canPass ? C.pale : "#efeff2",
      n.canPass ? C.blue : null,
      16,
    );
    const copyW = Math.max(89, w * 0.38),
      btnW = (w - copyW - 16) / 2;
    this.text(
      "是否选择否定？",
      x + 10,
      y + 17,
      11,
      C.ink,
      "left",
      600,
      copyW - 12,
    );
    this.box(x + 10, y + 31, copyW - 20, 3, "#d5dbe5", null, 2);
    if (n.progress)
      this.box(
        x + 10,
        y + 31,
        ((copyW - 20) * n.progress) / 100,
        3,
        urgent ? C.red : C.blue,
        null,
        2,
      );
    this.text(n.timerText || "", x + 10, y + 45, 11, urgent ? C.red : C.muted);
    this.button(
      n.buttonText || "打出否定",
      "nope-response",
      x + copyW,
      y + 6,
      btnW,
      44,
      { size: 11, disabled: !n.canNope, window: n.key },
    );
    this.button(
      "本次不出",
      "nope-pass",
      x + copyW + btnW + 6,
      y + 6,
      btnW,
      44,
      { size: 11, disabled: !n.canPass, window: n.key },
    );
    const giving =
      v.alive &&
      d.room.game.phase === "favor" &&
      d.room.game.pending?.target === v.myId;
    const mainW = (w - 10) * 0.64;
    this.button(
      giving
        ? "交牌"
        : `打出${d.selected.length > 1 ? " · " + d.selected.length + " 张" : ""}`,
      giving ? "give" : "prepare",
      x,
      y + 66,
      mainW,
      48,
      { primary: true, disabled: giving ? !v.canGive : !v.selection?.valid },
    );
    this.button("抽牌", "draw", x + mainW + 10, y + 66, w - mainW - 10, 48, {
      disabled: !v.canDraw,
    });
  }
  connection(value) {
    this.box(12, this.top - 22, this.w - 24, 22, "#fff0cf", null, 8);
    this.text(
      value,
      this.w / 2,
      this.top - 11,
      11,
      "#815a24",
      "center",
      400,
      this.w - 40,
    );
  }
  scrollIndicator(viewport, offset, max) {
    if (!max) return;
    const height = Math.max(25, (viewport.h * viewport.h) / (viewport.h + max));
    this.box(
      this.w - 5,
      viewport.y + (viewport.h - height) * clamp(offset / max, 0, 1),
      3,
      height,
      "#c2c5cd",
      null,
      2,
    );
  }
  modal() {
    const d = this.page.data,
      m = this.picker ? "picker" : this.layout.modal,
      available = this.h - this.top - this.bottom - 8;
    if (m === "phase-choice" || m === "play")
      return Choices.renderChoice(this, m);
    const w = this.w - 32;
    let preferredHeight = m === "create" ? 456 : 620;
    if (m === "bots") {
      const paragraphHeight = (text, size) =>
        this.lines(text, w - 36, size).length * 22 + 12;
      preferredHeight =
        76 +
        60 +
        58 +
        60 +
        12 +
        paragraphHeight(
          "Bot 会自动准备并参与对局。你仍需要点击准备，再开始游戏。",
          14,
        ) +
        paragraphHeight("添加数量", 12) +
        paragraphHeight(
          "默认关闭，方便观察卡牌效果；开启后 Bot 会在响应窗口使用否定牌。",
          12,
        );
    }
    const h = Math.min(preferredHeight, available),
      x = 16,
      y = this.top + Math.max(0, (available - h) / 2);
    this.layout.regions = [];
    this.ctx.fillStyle = "rgba(29,29,31,.32)";
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.box(x, y, w, h, C.white, C.line, 24);
    this.layout.modalRect = { x, y, w, h };
    const titles = {
      create: "一起开一局",
      detail: d.v?.detail?.name || "卡牌详情",
      profile: "选一只代表你的猫",
      join: "加入朋友的房间",
      bots: "添加验证 Bot",
      settings: "按你的习惯",
      history: "对局动态",
      rules: "活到最后，就赢了",
      play: d.v?.selection?.needsTarget ? d.v.targetLabel : "确认出牌",
      leave: d.room?.status === "playing" ? "暂时离开这一局？" : "离开房间？",
      "close-room": "关闭整个房间？",
      picker: this.picker?.title,
    };
    this.text(
      titles[m] || "",
      x + 18,
      y + 28,
      m === "play" ? 18 : 21,
      C.ink,
      "left",
      600,
      w - 78,
    );
    this.button(
      "×",
      this.picker ? "picker-close" : "close",
      x + w - 56,
      y + 6,
      44,
      44,
      { pill: true, size: 25 },
    );
    if (m === "create") {
      this.createModal(x, y, w, h);
      this.layout.scroll = { max: 0, offset: 0 };
      return;
    }
    const viewport = { x: x + 12, y: y + 58, w: w - 24, h: h - 76 };
    this.clip(viewport, () => {
      let cy = viewport.y - this.modalScroll,
        px = x + 18,
        pw = w - 36;
      const gap = () => {
        cy += 12;
      };
      const p = (s, size = 14, color = C.muted) => {
        cy = this.paragraph(s, px, cy, pw, size, color, 22);
        gap();
      };
      const button = (label, action, options = {}) => {
        this.button(label, action, px, cy, pw, 48, options);
        cy += 60;
      };
      if (m === "picker") {
        (this.picker.options || []).forEach((option, index) => {
          const chosen = index === this.picker.selected;
          this.box(
            px,
            cy,
            pw,
            48,
            chosen ? C.pale : C.white,
            chosen ? C.blue : C.line,
            14,
          );
          this.text(
            option.label ?? String(option),
            px + 14,
            cy + 24,
            15,
            chosen ? C.blue : C.ink,
            "left",
            chosen ? 600 : 400,
            pw - 32,
          );
          if (chosen)
            this.text("✓", px + pw - 20, cy + 24, 16, C.blue, "center", 600);
          this.region("pick-option", px, cy, pw, 48, {
            index,
            disabled: !!d.busy,
          });
          cy += 56;
        });
      }
      if (m === "history") {
        const g = d.room?.game;
        const logs = [
          ...(g?.privateLog || []).map((l) => "仅你可见 · " + l.text),
          ...(g?.logs || []).map((l) => l.text),
        ];
        if (!logs.length) p("还没有对局动态");
        logs.forEach((text) => p(text, 13));
      }
      if (m === "detail" && d.v?.detail) {
        this.card(d.v.detail, px + (pw - 170) / 2, cy, 170, 210);
        cy += 226;
        p(d.v.detail.description, 15, C.ink);
      }
      if (m === "profile") {
        (d.avatars || U.avatars).forEach((avatar, i) => {
          const col = i % 2,
            row = Math.floor(i / 2),
            cw = pw / 2;
          const ax = px + col * cw + (cw - 72) / 2,
            ay = cy + row * 118;
          this.avatar(
            { avatar: avatar.id, avatarStyle: avatar.style },
            ax,
            ay,
            72,
            d.avatar === avatar.id,
          );
          this.text(avatar.name, ax + 36, ay + 88, 14, C.ink, "center", 600);
          this.region("avatar", px + col * cw, ay, cw, 108, { id: avatar.id });
        });
        cy += Math.ceil((d.avatars || U.avatars).length / 2) * 118;
      }
      if (m === "join") {
        p("六位房间号");
        this.box(px, cy, pw, 52, "#fafafc", C.line, 16);
        this.text(
          d.code || "输入房间号",
          px + 16,
          cy + 26,
          20,
          d.code ? C.ink : C.muted,
          "left",
          400,
        );
        this.region("input", px, cy, pw, 52, { field: "code" });
        cy += 66;
        button("一起玩", "join-submit", { primary: true });
      }
      if (m === "bots") {
        p("Bot 会自动准备并参与对局。你仍需要点击准备，再开始游戏。");
        p("添加数量", 12);
        button((d.botCount || 1) + " 位 Bot ▾", "picker", { picker: "bot" });
        this.switchRow(
          "Bot 使用否定牌",
          "",
          px,
          cy,
          pw,
          "botSetting",
          "respondNope",
          d.respondNope,
        );
        cy += 58;
        p(
          "默认关闭，方便观察卡牌效果；开启后 Bot 会在响应窗口使用否定牌。",
          12,
        );
        button("添加 Bot", "bots-submit", {
          primary: true,
          disabled: !d.v?.canAddBots,
        });
      }
      if (m === "settings") {
        if (d.room?.game) button("查看对局动态", "history");
        this.switchRow(
          "回合提示音",
          "",
          px,
          cy,
          pw,
          "setting",
          "sound",
          d.settings?.sound,
        );
        cy += 64;
        this.switchRow(
          "减弱动态",
          "",
          px,
          cy,
          pw,
          "setting",
          "reduced",
          d.settings?.reduced,
        );
        cy += 70;
        button("玩法说明", "rules");
      }
      if (m === "rules") {
        RULES.forEach((s) => p(s, 15, C.ink));
      }
      if (m === "leave") {
        p(
          d.room?.status === "playing"
            ? "你的席位将由系统托管到本局结束。回来后可继续原局，期间不能加入其他房间。"
            : "离开后可以重新创建或加入朋友的房间。",
          15,
          C.ink,
        );
        button(d.v?.isHost ? "仅自己离开" : "确认离开", "leave-submit", {
          primary: true,
        });
        if (d.v?.isHost) {
          this.box(px, cy, pw, 1, C.line, null, 0);
          cy += 18;
          p("也可以结束这桌游戏，让大家一起返回大厅。", 13);
          button("关闭整个房间", "close-room", { danger: true });
        }
      }
      if (m === "close-room") {
        p(
          "当前对局将立即终止，不产生胜者。所有成员返回大厅，房间号失效。",
          15,
          C.ink,
        );
        p("关闭后无法恢复这一局。", 13);
        button("确认关闭房间", "close-room-submit", {
          primary: true,
          danger: true,
        });
        button("继续游戏", "close");
      }
      cy += 12;
      this.modalMax = Math.max(
        0,
        cy + this.modalScroll - (viewport.y + viewport.h),
      );
      this.layout.scroll = {
        max: this.modalMax,
        offset: this.modalScroll,
        viewport,
      };
    });
    this.scrollIndicator(viewport, this.modalScroll, this.modalMax);
  }
  switchRow(title, hint, x, y, w, handler, field, checked, height = 52) {
    this.text(title, x, y + (hint ? 17 : 26), 15, C.ink, "left", 600, w - 66);
    if (hint) this.text(hint, x, y + 37, 11, C.muted, "left", 400, w - 66);
    const sx = x + w - 54;
    this.box(sx, y + 10, 50, 30, checked ? C.blue : "#e1e2e7", null, 15);
    this.box(sx + (checked ? 22 : 3), y + 13, 24, 24, C.white, null, 12);
    this.region(handler, x, y, w, height, {
      field,
      checked: !!checked,
      disabled: !!this.page.data.busy,
    });
  }
  createModal(x, y, w, h) {
    const d = this.page.data,
      px = x + 18,
      pw = w - 36;
    const compact = h < 448;
    const rowHeight = compact ? 44 : 52;
    let cy = y + (compact ? 50 : 54);
    this.switchRow(
      "出牌不倒计时",
      "开启后，除否定外均不限时",
      px,
      cy,
      pw,
      "roomSetting",
      "noTurnTimer",
      d.noTurnTimer,
      rowHeight,
    );
    cy += rowHeight + 2;
    this.text("否定响应时长", px, cy + 10, 12, C.muted);
    cy += compact ? 18 : 24;
    const times = d.nopeTimes || [10, 20, 30, 0],
      tw = (pw - 12) / 4;
    times.forEach((seconds, i) => {
      const bx = px + i * (tw + 4),
        chosen = d.nopeSeconds === seconds;
      this.box(
        bx,
        cy,
        tw,
        44,
        chosen ? C.pale : "#f1f1f4",
        chosen ? C.blue : null,
        13,
      );
      this.text(
        seconds ? seconds + " 秒" : "不限时",
        bx + tw / 2,
        cy + 22,
        12,
        chosen ? C.blue : C.ink,
        "center",
        600,
      );
      this.region("nope-time", bx, cy, tw, 44, { seconds, disabled: !!d.busy });
    });
    cy += 48;
    this.switchRow(
      "可循环否定",
      "可否定上一张否定",
      px,
      cy,
      pw,
      "expansionSetting",
      "allowNopeChain",
      d.allowNopeChain,
      rowHeight,
    );
    cy += rowHeight + 4;
    this.text("六人扩展规则", px, cy + 10, 14, C.ink, "left", 600);
    this.text("2–5 人沿用基础版", px + 115, cy + 10, 10, C.muted);
    cy += compact ? 20 : 26;
    this.box(px - 5, cy, pw + 10, rowHeight * 2 + 2, "#fafafc", C.line, 16);
    this.switchRow(
      "加入内爆猫",
      d.includeImploding ? "首抽翻面，再抽出局" : "关闭：使用 5 张普通炸弹",
      px,
      cy,
      pw,
      "expansionSetting",
      "includeImploding",
      d.includeImploding,
      rowHeight,
    );
    this.box(px + 6, cy + rowHeight, pw - 12, 1, C.line, null, 0);
    this.switchRow(
      "加入反转",
      "改变方向，免抽一个回合",
      px,
      cy + rowHeight + 2,
      pw,
      "expansionSetting",
      "includeReverse",
      d.includeReverse,
      rowHeight,
    );
    this.button("创建好友房", "create-submit", px, y + h - 76, pw, 48, {
      primary: true,
    });
  }
  openPicker(kind) {
    const d = this.page.data;
    const specs = {
      position: {
        title: "秘密选择放回位置",
        options: d.v?.positions || [],
        selected: d.positionIndex || 0,
        method: "choosePosition",
      },
      named: {
        title: "声明想要的牌名",
        options: d.namedOptions || [],
        selected: d.namedIndex || 0,
        method: "chooseNamed",
      },
      bot: {
        title: "添加 Bot 数量",
        options: (d.v?.botCounts || []).map((n) => ({ label: n + " 位 Bot" })),
        selected: d.botCountIndex || 0,
        method: "chooseBotCount",
      },
    };
    const spec = specs[kind];
    if (!spec) return;
    this.picker = {
      ...spec,
      kind,
      parentModal: d.modal || "",
      context: this.contextKey,
      phase: d.room?.game?.phase,
      current: d.room?.game?.current,
    };
    this.modalScroll = 0;
    this.render(this.now);
  }
  dispatch(region) {
    if (!region || region.disabled || this.destroyed || this.page.data.busy)
      return;
    const a = region.action,
      d = this.page.data;
    const event = { currentTarget: { dataset: { ...region } }, detail: {} };
    if (
      a === "card" &&
      d.v.alive &&
      d.room?.game?.phase === "favor" &&
      d.room.game.pending?.target === d.v.myId
    ) {
      const selected = d.selected.includes(region.id) ? [] : [region.id];
      return this.page.updateData({
        selected,
        v: U.derive(d.room, selected, this.page.localMode),
      });
    }
    if (a === "choice-tab") {
      if (region.tab === "named" && !d.v.targets.some((p) => p.id === d.target))
        return;
      this.choiceState.tab = region.tab;
      return this.invalidate();
    }
    if (a === "choice-page") {
      this.choiceState.namedPage += region.step;
      return this.invalidate();
    }
    if (
      a === "choice-named" &&
      d.modal === "play" &&
      d.namedOptions[region.index]
    ) {
      return this.page.chooseNamed({ detail: { value: String(region.index) } });
    }
    if (
      a === "choice-position" &&
      d.v.alive &&
      d.v.turn &&
      d.room?.game?.phase === "insert"
    ) {
      const last = d.v.positions.length - 1;
      const index =
        region.index === -1
          ? Math.floor(Math.random() * (last + 1))
          : clamp(region.index, 0, last);
      return this.page.choosePosition({ detail: { value: String(index) } });
    }
    if (a === "history") return this.page.updateData({ modal: "history" });
    if (a === "input") return this.onInput(region.field);
    if (a === "share")
      return this.wx.shareAppMessage(
        this.share
          ? this.share()
          : {
              title: "来玩炸弹猫，房间号 " + d.room.code,
              query: "room=" + d.room.code,
              imageUrl: "assets/share.png",
            },
      );
    if (
      ["roomSetting", "expansionSetting", "botSetting", "setting"].includes(a)
    ) {
      event.detail.value = !region.checked;
      return this.page[a](event);
    }
    if (a === "picker") return this.openPicker(region.picker);
    if (a === "picker-close") {
      this.picker = null;
      this.modalScroll = 0;
      return;
    }
    if (a === "pick-option") {
      const picker = this.picker;
      if (
        !picker ||
        picker.context !== this.contextKey ||
        d.modal !== picker.parentModal
      )
        return;
      event.detail.value = String(region.index);
      this.page[picker.method](event);
      this.picker = null;
      this.modalScroll = 0;
      return;
    }
    return this.page.action(event);
  }
  touchPoint(event, end = false) {
    const p =
      (end ? event.changedTouches : event.touches)?.[0] ||
      event.changedTouches?.[0] ||
      event.touches?.[0];
    return p
      ? { x: p.clientX ?? p.pageX ?? p.x, y: p.clientY ?? p.pageY ?? p.y }
      : null;
  }
  touchStart(event) {
    if (this.destroyed) return;
    const p = this.touchPoint(event);
    if (!p) return;
    const region = [...this.layout.regions]
      .reverse()
      .find((r) => inside(r, p.x, p.y));
    this.gesture = {
      start: p,
      last: p,
      region,
      moved: false,
      axis: null,
      hand: !this.layout.modal && inside(this.layout.hand?.viewport, p.x, p.y),
      modal: !!this.layout.modal,
      offset: this.handOffset,
      scroll: this.layout.modal ? this.modalScroll : this.pageScroll,
      scrollable:
        this.layout.screen !== "game" ||
        inside(this.layout.scroll.viewport, p.x, p.y),
      context: this.contextKey,
      modalKey: this.layout.modal,
      phase: this.page.data.room?.game?.phase,
    };
    this.invalidate();
  }
  touchMove(event) {
    const p = this.touchPoint(event),
      g = this.gesture;
    if (!p || !g) return;
    const dx = p.x - g.start.x,
      dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 8) {
      g.moved = true;
      g.axis = g.hand && Math.abs(dx) > Math.abs(dy) ? "hand" : "vertical";
    }
    if (g.moved) {
      if (g.axis === "hand") {
        this.handOffset = clamp(g.offset - dx, 0, this.layout.hand?.max || 0);
        this.page.handScroll = this.handOffset;
        this.page.handScrolled?.({ detail: { scrollLeft: this.handOffset } });
      } else if (g.modal) {
        if (this.layout.modal !== "create")
          this.modalScroll = clamp(g.scroll - dy, 0, this.modalMax || 0);
      } else if (this.layout.screen !== "home" && g.scrollable) {
        this.pageScroll = clamp(g.scroll - dy, 0, this.pageMax || 0);
      }
      this.render(this.now);
    }
    g.last = p;
    this.invalidate();
  }
  touchEnd(event) {
    const g = this.gesture,
      p = this.touchPoint(event, true);
    this.gesture = null;
    if (!g || !p) return;
    if (
      !g.moved &&
      g.context === this.contextKey &&
      g.modalKey === this.layout.modal &&
      g.phase === this.page.data.room?.game?.phase &&
      inside(g.region, p.x, p.y)
    )
      this.dispatch(g.region);
    this.invalidate();
  }
  touchCancel() {
    this.gesture = null;
    this.invalidate();
  }
  drawPressed() {
    const r = this.gesture?.region;
    if (!r || r.disabled || this.gesture.moved) return;
    this.box(r.x, r.y, r.w, r.h, "rgba(0,102,204,.07)", null, 16);
  }
  invalidate() {
    this.onInvalidate?.();
  }
  motion(items) {
    const effect = items[0];
    if (!effect) {
      this.motionKey = null;
      this.layout.motion = null;
      return;
    }
    const key = effect.renderId ?? effect;
    if (this.motionKey !== key) {
      this.motionKey = key;
      this.motionStarted = this.now;
    }
    const reduced = !!this.page.data.settings?.reduced,
      duration = ["draw", "future"].includes(effect.kind) ? 1600 : 5000,
      elapsed = Math.max(0, this.now - this.motionStarted),
      enter = clamp(elapsed / 500, 0, 1),
      exit = clamp((duration - elapsed) / 300, 0, 1);
    const alpha = reduced ? 1 : Math.min(enter, exit);
    this.layout.motion = {
      kind: effect.kind,
      explosion: !!effect.explosion,
      opacity: alpha,
      elapsed,
      duration,
    };
    if (elapsed >= duration && !reduced) return;
    if (effect.kind === "defuse" && effect.actor) {
      const table = this.layout.table,
        compact = table?.h < 260,
        w = Math.min(this.w - 54, 304),
        h = compact ? 128 : 144,
        x = (this.w - w) / 2,
        y = table ? table.y + Math.max(0, (table.h - h) / 2) : this.top + 82,
        art = compact ? 96 : 112,
        tx = x + art + 28,
        tw = w - art - 44,
        cx = tx + tw / 2,
        rowY = y + (compact ? 18 : 22);
      const c = this.ctx;
      c.save();
      c.globalAlpha = alpha;
      this.box(x, y, w, h, C.white, C.line, 24);
      this.cardArt(effect.card, x + 16, y + 16, art, art);
      this.avatar(effect.actor, cx - 16, rowY, 32);
      this.text(
        effect.actor.name,
        cx,
        rowY + 44,
        compact ? 16 : 18,
        C.ink,
        "center",
        700,
        tw,
      );
      this.text("拆弹成功", cx, rowY + 66, 15, C.blue, "center", 600, tw);
      this.text(
        "正在秘密放回炸弹猫",
        cx,
        rowY + 86,
        11,
        C.muted,
        "center",
        400,
        tw,
      );
      c.restore();
      return;
    }
    const w = Math.min(this.w - 54, 304),
      h = effect.card ? 282 : 128,
      x = (this.w - w) / 2,
      y = this.top + 82 + (reduced ? 0 : (1 - enter) * 30);
    const c = this.ctx;
    c.save();
    c.globalAlpha = alpha;
    if (effect.explosion && !reduced && elapsed < 900) {
      const t = elapsed / 900,
        cx = this.w / 2,
        cy = y + h * 0.55;
      c.save();
      c.globalAlpha = (1 - t) * alpha;
      c.beginPath();
      c.arc(cx, cy, 36 + t * 110, 0, Math.PI * 2);
      c.strokeStyle = "#f7a354";
      c.lineWidth = 10 * (1 - t) + 1;
      c.stroke();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const sx = cx + Math.cos(angle) * (45 + t * 135),
          sy = cy + Math.sin(angle) * (45 + t * 135);
        this.box(sx, sy, 8, 12, i % 2 ? "#ef737a" : "#f7c56b", null, 3);
      }
      c.restore();
    }
    this.box(x, y, w, h, "rgba(255,255,255,.97)", C.line, 24);
    let cy = y + 14;
    if (effect.actor) {
      const hasTarget = !!effect.target;
      const ax = hasTarget ? this.w / 2 - 60 : this.w / 2 - 23;
      this.avatar(effect.actor, ax, cy, 46);
      if (hasTarget) {
        this.text("→", this.w / 2, cy + 23, 20, C.blue, "center");
        this.avatar(effect.target, this.w / 2 + 14, cy, 46);
      }
      cy += 60;
    }
    if (effect.relationship || effect.actor) {
      this.text(
        effect.relationship || effect.actor.name,
        this.w / 2,
        cy,
        22,
        C.ink,
        "center",
        700,
        w - 24,
      );
      cy += 30;
    }
    this.text(
      effect.actionText || effect.title,
      this.w / 2,
      cy,
      18,
      effect.explosion ? C.red : C.blue,
      "center",
      600,
      w - 24,
    );
    cy += 18;
    if (effect.card) {
      this.card(effect.card, this.w / 2 - 58, cy, 116, 144);
      if (effect.count > 1)
        this.text(
          "× " + effect.count,
          this.w / 2 + 77,
          cy + 72,
          18,
          C.blue,
          "center",
          600,
        );
    }
    c.restore();
  }
  needsFrame() {
    if (this.destroyed) return false;
    if (this.imageDirty) return true;
    const effect = this.page.data.motionItems?.[0];
    return (
      !!effect &&
      !this.page.data.settings?.reduced &&
      this.now - this.motionStarted <
        (["draw", "future"].includes(effect.kind) ? 1600 : 5000)
    );
  }
  destroy() {
    this.destroyed = true;
    this.gesture = null;
    this.picker = null;
    for (const entry of this.images.values()) {
      entry.image.onload = null;
      entry.image.onerror = null;
    }
    this.images.clear();
  }
}
module.exports = { CanvasUI };
