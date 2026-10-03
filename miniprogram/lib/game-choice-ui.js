"use strict";
const U = require("./controller");
const INK = "#1d1d1f",
  BLUE = "#0071e3",
  MUTED = "#777782",
  LINE = "#e0e0e8",
  PALE = "#eaf2ff";
function phaseChoice(d) {
  return (
    d.v?.alive &&
    d.v?.turn &&
    ["future", "alterFuture", "defuse", "insert"].includes(d.room?.game?.phase)
  );
}
function renderChoice(ui, mode) {
  const d = ui.page.data,
    v = d.v,
    g = d.room.game;
  const phase = mode === "play" ? "play" : g.phase;
  const key =
    ui.contextKey +
    ":" +
    phase +
    ":" +
    (phase === "play" ? d.selected.join(",") : g.current);
  if (ui.choiceState?.key !== key)
    ui.choiceState = { key, tab: "target", namedPage: 0 };
  const state = ui.choiceState;
  // A target can leave while this dialog is open. Return to its first step.
  if (phase === "play" && !v.targets.some((p) => p.id === d.target))
    state.tab = "target";
  const preferred =
    phase === "play"
      ? v.selection.needsTarget
        ? 440
        : 300
      : { future: 350, alterFuture: 410, defuse: 280, insert: 328 }[phase];
  const h = Math.min(preferred, ui.h - ui.top - ui.bottom - 8),
    w = ui.w - 32;
  const x = 16,
    y = ui.top + Math.max(0, (ui.h - ui.top - ui.bottom - 8 - h) / 2),
    px = x + 16,
    pw = w - 32;
  const cy = y + 62,
    buttonY = y + h - 64;
  ui.layout.regions = [];
  ui.ctx.fillStyle = "rgba(29,29,31,.32)";
  ui.ctx.fillRect(0, 0, ui.w, ui.h);
  ui.box(x, y, w, h, "#fff", LINE, 24);
  ui.layout.modalRect = { x, y, w, h };
  ui.layout.scroll = { max: 0, offset: 0, viewport: { x, y, w, h } };
  ui.modalMax = 0;
  ui.modalScroll = 0;
  const named =
    phase === "play" && v.selection.needsNamed && state.tab === "named";
  const title =
    phase === "play"
      ? named
        ? "点名要哪张牌"
        : v.selection.needsTarget
          ? "选择一位玩家"
          : "确认出牌"
      : {
          future: "悄悄看未来",
          alterFuture: "秘密调整未来",
          defuse: "用拆弹保住自己",
          insert:
            g.bomb?.type === "imploding" ? "翻面内爆猫 · 放回" : "拆弹成功",
        }[phase];
  ui.text(title, px, y + 28, 18, INK, "left", 600, pw - 60);
  ui.button(
    phase === "play" ? "×" : "离开",
    phase === "play" ? "close" : "leave",
    x + w - 68,
    y + 6,
    52,
    44,
    { pill: true, size: phase === "play" ? 24 : 12 },
  );
  const btn = (label, action, bx, by, bw, extra = {}) =>
    ui.button(label, action, bx, by, bw, 44, {
      size: 12,
      ...extra,
      disabled: !!d.busy || !!extra.disabled,
    });
  const primary = (label, action, extra = {}) =>
    ui.button(label, action, px, buttonY, pw, 48, {
      primary: true,
      ...extra,
      disabled: !!d.busy || !!extra.disabled,
    });
  const line = (text, by, color = MUTED) =>
    ui.text(text, px, by, 11, color, "left", 400, pw);
  if (phase === "future") {
    line("只有你能看见预知 · 第一张最先抽到", cy + 10);
    const cards = v.future || [],
      gap = 8,
      cw =
        (pw - gap * Math.max(0, cards.length - 1)) / Math.max(1, cards.length);
    const cardY = cy + 42,
      cardH = Math.min(150, buttonY - cardY - 12);
    cards.forEach((card, i) => {
      const tx = px + i * (cw + gap),
        art = Math.min(cw - 12, cardH - 50);
      ui.text("第" + (i + 1) + "张", tx + cw / 2, cy + 31, 11, MUTED, "center");
      ui.box(
        tx,
        cardY,
        cw,
        cardH,
        card.type === "bomb" ? "#fff2f4" : "#fafafc",
        LINE,
        16,
      );
      ui.cardArt(card, tx + 6, cardY + 6, cw - 12, art);
      const lines = ui.lines(card.name, cw - 12, 12);
      lines.forEach((s, j) =>
        ui.text(
          s,
          tx + cw / 2,
          cardY + art + 21 + j * 16,
          12,
          card.type === "bomb" ? "#d9182b" : INK,
          "center",
          600,
          cw - 12,
        ),
      );
    });
    primary("看好了，继续", "closeFuture");
  }
  if (phase === "alterFuture") {
    line("仅你可见 · 第一张最先抽到", cy + 10);
    const cards = d.futureState?.cards || [],
      rowY = cy + 22;
    const rowH = Math.min(
      96,
      (buttonY - rowY - 12) / Math.max(1, cards.length),
    );
    cards.forEach((card, i) => {
      const ty = rowY + i * rowH,
        rh = rowH - 4,
        art = Math.min(52, rh - 8),
        controlY = ty + (rh - 44) / 2;
      ui.box(px, ty, pw, rh, "#fafafc", LINE, 14);
      ui.text(String(i + 1), px + 12, ty + rh / 2, 12, MUTED, "center", 600);
      ui.cardArt(card, px + 25, ty + (rh - art) / 2, art, art);
      const labelX = px + 31 + art,
        labelW = pw - art - 133;
      const lines = ui.lines(card.name, labelW, 11).slice(0, 2);
      lines.forEach((s, j) =>
        ui.text(
          s,
          labelX,
          ty + rh / 2 + (j - (lines.length - 1) / 2) * 14,
          11,
          INK,
          "left",
          600,
          labelW,
        ),
      );
      btn("↑", "future-up", px + pw - 96, controlY, 44, {
        id: card.id,
        disabled: !card.canUp,
        size: 20,
      });
      btn("↓", "future-down", px + pw - 48, controlY, 44, {
        id: card.id,
        disabled: !card.canDown,
        size: 20,
      });
    });
    primary("确认顺序，继续", "orderFuture", {
      disabled: !d.futureState?.canConfirm,
    });
  }
  if (phase === "defuse") {
    const artH = Math.min(120, buttonY - cy - 12),
      artW = Math.min(98, artH);
    ui.card(U.card({ type: "defuse" }), px, cy, artW, artH);
    const tx = px + artW + 14,
      tw = pw - artW - 14;
    ui.paragraph(
      "抽到了炸弹猫！使用拆弹后，秘密放回。",
      tx,
      cy + 15,
      tw,
      13,
      INK,
      20,
    );
    primary("使用拆弹", "defuse");
  }
  if (phase === "insert") {
    const stepY = buttonY - 112,
      bodyH = stepY - cy,
      artH = Math.min(64, bodyH - 16),
      groupW = Math.min(pw, 240),
      groupX = x + (w - groupW) / 2,
      tx = groupX + artH + 12,
      tw = groupW - artH - 12,
      middle = cy + bodyH / 2,
      actor = v.players.find((p) => p.id === g.current),
      imploding = g.bomb?.type === "imploding";
    ui.cardArt(
      U.card(g.bomb || { type: "bomb" }),
      groupX,
      middle - artH / 2,
      artH,
      artH,
    );
    ui.text(
      actor?.name || "你",
      tx + tw / 2,
      middle - 20,
      14,
      INK,
      "center",
      600,
      tw,
    );
    ui.text(
      imploding ? "秘密放回内爆猫" : "秘密放回炸弹猫",
      tx + tw / 2,
      middle,
      12,
      BLUE,
      "center",
      600,
      tw,
    );
    ui.text(
      imploding ? "仅你知道位置 · 再抽即出局" : "放回位置仅你可见",
      tx + tw / 2,
      middle + 20,
      10,
      MUTED,
      "center",
      400,
      tw,
    );
    const index = Math.max(
      0,
      Math.min((v.positions?.length || 1) - 1, d.positionIndex || 0),
    );
    ui.box(px, stepY, pw, 48, "#fafafc", LINE, 16);
    btn("−", "choice-position", px, stepY + 2, 44, {
      index: index - 1,
      disabled: index === 0,
      size: 20,
    });
    btn("＋", "choice-position", px + pw - 44, stepY + 2, 44, {
      index: index + 1,
      disabled: index === v.positions.length - 1,
      size: 20,
    });
    ui.text(
      v.positions[index]?.label || "选择位置",
      px + pw / 2,
      stepY + 24,
      12,
      INK,
      "center",
      600,
      pw - 100,
    );
    const bw = (pw - 12) / 3;
    [
      ["牌顶", 0],
      ["随机", -1],
      ["牌底", v.positions.length - 1],
    ].forEach(([label, idx], i) =>
      btn(label, "choice-position", px + i * (bw + 6), buttonY - 56, bw, {
        index: idx,
      }),
    );
    primary("确认放回", "insert");
  }
  if (phase === "play") {
    const selected = v.selectedCards || [];
    const summary =
      selected.length > 1
        ? selected.length + "张 · " + selected[0]?.name
        : selected[0]?.name || "";
    if (!v.selection.needsTarget) {
      const ch = Math.min(130, buttonY - cy - 40),
        cw = Math.min(104, pw),
        cx = px + (pw - cw) / 2;
      if (selected[0]) ui.card(selected[0], cx, cy, cw, ch);
      line(v.selection.hint, buttonY - 15);
      primary("确认打出", "play", { disabled: !v.selection.valid });
    } else if (!named) {
      if (selected[0]) ui.cardArt(selected[0], px, cy, 30, 30);
      ui.text(summary, px + 40, cy + 15, 12, INK, "left", 600, pw - 40);
      const targets = v.targets || [],
        cols = h < 400 ? 3 : 2,
        rows = Math.ceil(targets.length / cols),
        gap = 6;
      const gridY = cy + 36,
        tileW = (pw - gap * (cols - 1)) / cols,
        rowH = Math.min(90, (buttonY - gridY - 8) / Math.max(1, rows));
      targets.forEach((p, i) => {
        const tx = px + (i % cols) * (tileW + gap),
          ty = gridY + Math.floor(i / cols) * rowH,
          th = rowH - 4,
          compact = th < 76,
          as = compact ? 32 : 44,
          nameSize = compact ? 12 : 14,
          countSize = compact ? 10 : 11,
          contentH = as + nameSize + countSize + 6,
          avatarY = ty + (th - contentH) / 2,
          nameY = avatarY + as + 3 + nameSize / 2;
        ui.box(
          tx,
          ty,
          tileW,
          th,
          d.target === p.id ? PALE : "#fafafc",
          d.target === p.id ? BLUE : LINE,
          14,
        );
        ui.avatar(p, tx + (tileW - as) / 2, avatarY, as, d.target === p.id);
        ui.text(
          p.name + (p.isMe ? " · 你" : ""),
          tx + tileW / 2,
          nameY,
          nameSize,
          INK,
          "center",
          600,
          tileW - 8,
        );
        ui.text(
          "剩余 " + p.count + " 张牌",
          tx + tileW / 2,
          nameY + nameSize / 2 + 3 + countSize / 2,
          countSize,
          MUTED,
          "center",
          400,
          tileW - 8,
        );
        ui.region("target", tx, ty, tileW, th, {
          id: p.id,
          disabled: !!d.busy,
        });
      });
      const validTarget = targets.some((p) => p.id === d.target);
      primary(
        v.selection.needsNamed ? "下一步 · 选择牌名" : "确认打出",
        v.selection.needsNamed ? "choice-tab" : "play",
        { tab: "named", disabled: !v.selection.valid || !validTarget },
      );
    } else {
      const target = v.targets.find((p) => p.id === d.target);
      if (target) ui.avatar(target, px, cy, 28, true);
      ui.text(
        target?.name || "",
        px + 36,
        cy + 14,
        12,
        INK,
        "left",
        600,
        pw - 120,
      );
      btn("换玩家", "choice-tab", px + pw - 76, cy - 8, 76, { tab: "target" });
      const options = d.namedOptions || [],
        pageSize = 6,
        pageMax = Math.max(0, Math.ceil(options.length / pageSize) - 1);
      state.namedPage = Math.max(0, Math.min(pageMax, state.namedPage));
      const cols = h < 400 ? 3 : 2,
        rows = Math.ceil(pageSize / cols),
        gap = 6;
      const gridY = cy + 36,
        pagerY = buttonY - 50,
        rh = Math.min(58, (pagerY - gridY - 6) / rows),
        tw = (pw - gap * (cols - 1)) / cols;
      options
        .slice(state.namedPage * pageSize, (state.namedPage + 1) * pageSize)
        .forEach((option, i) => {
          const idx = state.namedPage * pageSize + i,
            tx = px + (i % cols) * (tw + gap),
            ty = gridY + Math.floor(i / cols) * rh,
            th = rh - 4;
          ui.box(
            tx,
            ty,
            tw,
            th,
            idx === d.namedIndex ? PALE : "#fafafc",
            idx === d.namedIndex ? BLUE : LINE,
            12,
          );
          const lines = ui.lines(option.label, tw - 10, 11).slice(0, 2);
          lines.forEach((s, j) =>
            ui.text(
              s,
              tx + tw / 2,
              ty + th / 2 + (j - (lines.length - 1) / 2) * 14,
              11,
              INK,
              "center",
              600,
              tw - 10,
            ),
          );
          ui.region("choice-named", tx, ty, tw, th, {
            index: idx,
            disabled: !!d.busy,
          });
        });
      btn("‹", "choice-page", px, pagerY, 44, {
        step: -1,
        disabled: state.namedPage === 0,
        size: 20,
      });
      btn("›", "choice-page", px + pw - 44, pagerY, 44, {
        step: 1,
        disabled: state.namedPage === pageMax,
        size: 20,
      });
      ui.text(
        state.namedPage + 1 + " / " + (pageMax + 1),
        px + pw / 2,
        pagerY + 22,
        11,
        MUTED,
        "center",
      );
      primary(
        "向" +
          (target?.name || "玩家") +
          "要「" +
          (options[d.namedIndex]?.label || "") +
          "」",
        "play",
        {
          size: 12,
          disabled: !target || !options.some((o) => o.value === d.named),
        },
      );
    }
  }
}
module.exports = { phaseChoice, renderChoice };
