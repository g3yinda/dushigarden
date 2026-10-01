(function (root, factory) {
  const api = factory();
  if (typeof module === "object") module.exports = api;
  else root.BoomUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const names = {
    bomb: "炸弹猫",
    defuse: "拆弹",
    attack: "攻击 ×2",
    skip: "跳过",
    favor: "索要",
    shuffle: "洗牌",
    future: "预知 ×3",
    nope: "否定",
    imploding: "内爆猫",
    targetAttack: "定向攻击 ×2",
    reverse: "反转",
    bottom: "抽牌底",
    alterFuture: "调整未来 ×3",
    feral: "野猫",
    cat1: "困困猫",
    cat2: "饭团猫",
    cat3: "宇航猫",
    cat4: "侦探猫",
    cat5: "摇滚猫",
  };
  const descriptions = {
    imploding: "首次抽到，翻面并秘密插回，不消耗拆弹；再次抽到立即出局，不能拆弹或否定。",
    targetAttack: "不抽牌，指定任一存活玩家（包括自己）行动两回合；被攻击时转移剩余回合再加二。",
    reverse: "反转行动方向，不抽牌并完成一个回合；只有两人存活时按跳过处理。",
    bottom: "从牌堆底抽一张并完成一个回合；抽到炸弹或内爆猫仍按危险牌规则处理。",
    alterFuture: "秘密查看牌顶最多三张，调整顺序并确认；完成后仍需继续回合。",
    feral: "只可代替一种普通猫组成对子或三张，也可全用野猫组合；不能替代功能牌，单张无效果。",
    bomb: "抽到它会爆炸！有拆弹就能保命。",
    defuse: "抽到炸弹时使用，然后秘密放回炸弹。也能作为同名组合材料。",
    attack: "结束自己的回合，让下家行动两回合；被攻击时转移剩余回合再加二。",
    skip: "不抽牌，完成一个回合。被攻击时可能仍需继续行动。",
    favor: "指定一名有牌的对手，由对方选一张牌给你。",
    shuffle: "重新洗匀剩余牌堆，不结束回合。",
    future: "秘密查看牌堆顶最多三张，保持顺序不变。",
    nope: "响应期间取消一个效果，也可以否定上一张否定；不能否定抽牌、炸弹或拆弹。",
  };
  const avatars = [
    { id: 0, name: "奶油", style: "width:1059.3%;left:-400%;top:-219.3%;" },
    { id: 1, name: "桃桃", style: "width:1059.3%;left:-558.6%;top:-219.3%;" },
    { id: 2, name: "橘子", style: "width:1059.3%;left:-400%;top:-379.3%;" },
    { id: 3, name: "乌云", style: "width:1059.3%;left:-558.6%;top:-379.3%;" },
  ];
  const crops = {
    bomb: [40, 130, 333, 252],
    defuse: [415, 130, 333, 252],
    attack: [789, 130, 333, 252],
    skip: [1165, 130, 333, 252],
    favor: [40, 633, 333, 252],
    shuffle: [415, 633, 333, 252],
    future: [789, 633, 333, 252],
    nope: [1165, 633, 333, 252],
    cat1: [223, 94, 325, 265],
    cat2: [606, 94, 325, 265],
    cat3: [988, 94, 325, 265],
    cat4: [223, 598, 325, 265],
    cat5: [606, 598, 325, 265],
  };
  const shorts = {
    imploding: "翻面后再抽即出局",
    targetAttack: "指定玩家行动 2 回合",
    reverse: "反转方向，免抽 1 回合",
    bottom: "抽牌底，完成 1 回合",
    alterFuture: "重排牌顶最多 3 张",
    feral: "普通猫组合万能牌",
    bomb: "抽到就爆炸",
    defuse: "抵消一次爆炸",
    attack: "下家行动 2 回合",
    skip: "免抽，结束 1 回合",
    favor: "对方选牌给你",
    shuffle: "打乱剩余牌堆",
    future: "偷看牌顶 3 张",
    nope: "取消或恢复动作",
  };
  const expansionTypes = ["imploding", "targetAttack", "reverse", "bottom", "alterFuture", "feral"];
  const symbols = { imploding: "✹", targetAttack: "◎", reverse: "↺", bottom: "↓", alterFuture: "⇅", feral: "★" };
  function namedOptions(r) {
    const expanded = r?.game?.rulesVersion === "ek-imploding-2023-online-v1";
    return Object.entries(names)
      .filter(([type]) => !["bomb", "imploding"].includes(type) && (expanded || !expansionTypes.includes(type)))
      .map(([value, label]) => ({ value, label }));
  }
  function card(c) {
    const expansionIndex = expansionTypes.indexOf(c.type);
    const imploding = c.type === "imploding";
    const faceUp = c.faceUp === true;
    const [x, y, w, h] = crops[c.type] || crops.cat1;
    return {
      ...c,
      name: names[c.type] || c.type,
      description:
        (imploding
          ? faceUp
            ? "当前已翻面，抽到立即出局。拆弹无法保命，也不能否定；可在调整未来时改变它的位置。"
            : "当前未翻面，首次抽到翻面并秘密放回，不消耗拆弹；以后再抽到会立即出局，不能拆弹或否定。"
          : descriptions[c.type]) ||
        "单张无效果。两张同名随机取牌；三张同名声明一种牌并向对手索取。",
      short: imploding ? (faceUp ? "已翻面：抽到立即出局" : "未翻面：抽到翻面放回") : shorts[c.type] || "同名组合偷牌",
      stateLabel: imploding ? (faceUp ? "已翻面" : "未翻面") : "",
      source: expansionIndex >= 0 ? "expansion.jpg" : c.type.startsWith("cat") ? "cats.jpg" : "core.jpg",
      expansion: expansionTypes.includes(c.type),
      art: expansionIndex >= 0
        ? `width:300%;left:${-(expansionIndex % 3) * 100}%;top:50%;transform:translateY(-${expansionIndex < 3 ? 25 : 75}%);`
        : `width:${153600 / w}%;left:${(-100 * x) / w}%;top:${(-100 * y * 1.38) / w}%;`,
      symbol: symbols[c.type] || "",
    };
  }
  function me(r) {
    return typeof r.me === "object" ? r.me.id : r.me;
  }
  function selection(r, ids) {
    const g = r && r.game;
    let result = {
      valid: false,
      needsTarget: false,
      needsNamed: false,
      hint: "轻点手牌，查看用途或组成同名组合",
      cards: [],
    };
    if (!g) return result;
    const cards = g.hand.filter((c) => ids.includes(c.id));
    result.cards = cards;
    if (!cards.length) return result;
    result.hint = card(cards[0]).description;
    const alive = g.players.find((p) => p.id === me(r));
    if (!alive || !alive.alive || g.current !== me(r) || g.phase !== "action")
      return { ...result, hint: "现在可查看手牌，等待可行动时再出牌" };
    if (cards.length === 1) {
      let t = cards[0].type;
      return {
        ...result,
        valid:
          ["attack", "skip", "favor", "shuffle", "future", "targetAttack", "reverse", "bottom", "alterFuture"].includes(t) &&
          (t !== "favor" ||
            g.players.some((p) => p.alive && p.id !== me(r) && p.count > 0)),
        needsTarget: t === "favor" || t === "targetAttack",
        targetAttack: t === "targetAttack",
        hint: t === "feral" ? "野猫需要搭配普通猫或其他野猫组成两张、三张组合" : t.startsWith("cat")
          ? "普通猫需要两张或三张同名组合"
          : t === "nope"
            ? "否定只能在响应窗口单张使用"
            : result.hint,
      };
    }
    const hasFeral = cards.some((c) => c.type === "feral");
    const ordinary = cards.filter((c) => c.type !== "feral");
    const legalCombo = hasFeral
      ? ordinary.every((c) => /^cat[1-5]$/.test(c.type) && c.type === ordinary[0].type)
      : cards.every((c) => c.type === cards[0].type);
    if (cards.length > 3 || !legalCombo || cards.some((c) => ["bomb", "imploding"].includes(c.type)))
      return { ...result, hint: hasFeral ? "野猫只能搭配同一种普通猫，或全用野猫组合" : "组合需要两张或三张同名牌" };
    return {
      ...result,
      valid:
        cards.length === 3 ||
        g.players.some((p) => p.alive && p.id !== me(r) && p.count > 0),
      needsTarget: true,
      needsNamed: cards.length === 3,
      hint:
        (cards.length === 2
          ? "两张同名：随机获得对手一张牌"
          : "三张同名：声明想要的牌名") +
        (cards[0].type === "defuse" ? "。注意：将消耗保命用的拆弹" : ""),
    };
  }
  function derive(r, ids, localMode = false) {
    if (!r) return {};
    const g = r.game,
      id = me(r);
    const ps = (g ? g.players : r.players).map((p) => ({
      ...p,
      isBot: !!(p.isBot ?? r.players.find((seat) => seat.id === p.id)?.isBot),
      avatarStyle: avatars[Number(p.avatar) % 4]?.style || avatars[0].style,
      isMe: p.id === id,
      isHost: p.id === r.hostId,
      active: g && p.id === g.current,
    }));
    const base = {
      players: ps,
      rulesLabel: g?.rulesVersion === "ek-original-2025-friends-6p-v1"
        ? "六人朋友规则（旧局）"
        : g?.rulesVersion === "ek-imploding-2023-online-v1" || (!g && r.players.length === 6)
          ? "完整内爆猫扩展" : "基础版",
      noTurnTimer: r.options?.noTurnTimer === true,
      nopeSeconds: r.options?.nopeSeconds ?? 10,
      isHost: r.hostId === id,
      myId: id,
      ready: !!r.players.find((p) => p.id === id)?.ready,
      canStart: r.players.length >= 2 && r.players.every((p) => p.ready),
      canAddBots:
        localMode &&
        r.status === "waiting" &&
        !g &&
        r.hostId === id &&
        r.players.length < 6,
      botCounts: Array.from(
        { length: Math.max(0, Math.min(5, 6 - r.players.length)) },
        (_, i) => i + 1,
      ),
      selection: selection(r, ids || []),
      namedOptions: namedOptions(r),
    };
    if (!g) return base;
    const myIndex = ps.findIndex((p) => p.isMe);
    const positions = {
      2: [[50, 10]],
      3: [
        [18, 17],
        [82, 17],
      ],
      4: [
        [12, 47],
        [50, 10],
        [88, 47],
      ],
      5: [
        [12, 47],
        [30, 10],
        [70, 10],
        [88, 47],
      ],
      6: [
        [12, 62],
        [12, 22],
        [50, 10],
        [88, 22],
        [88, 62],
      ],
    };
    const tablePlayers = ps.map((_, i) => {
      const p = ps[(Math.max(0, myIndex) + i) % ps.length];
      const [x, y] =
        i === 0 ? [50, 90] : positions[ps.length]?.[i - 1] || [50, 10];
      return { ...p, seatStyle: `left:${x}%;top:${y}%;` };
    });
    const alive = !!g.players.find((p) => p.id === id)?.alive,
      turn = g.current === id,
      current = g.players.find((p) => p.id === g.current);
    const phases = {
      action: turn ? "轮到你" : `${current?.name || "对方"}的回合`,
      nope: "否定响应时间",
      favor: "等待交出一张牌",
      future: turn ? "只有你能看到预知" : "对方正在预知",
      alterFuture: turn ? "秘密调整未来" : "对方正在调整未来",
      defuse: turn ? "拆弹，安全第一" : "对方正在拆弹",
      insert: g.bomb?.type === "imploding" ? (turn ? "秘密插回内爆猫" : "对方正在插回内爆猫") : (turn ? "秘密放回炸弹" : "对方正在放回炸弹"),
      finished: "本局结束",
    };
    return {
      ...base,
      tablePlayers,
      alive,
      turn,
      phaseTitle: phases[g.phase] || "等待同步",
      canDraw: alive && turn && g.phase === "action",
      canNope:
        alive && g.phase === "nope" &&
        (!g.pending?.responses?.[me(r)] || g.pending.responses[me(r)] === "waiting") && g.hand.some((c) => c.type === "nope"),
      canGive:
        alive &&
        g.phase === "favor" &&
        g.pending?.target === id &&
        (ids || []).length === 1 &&
        g.hand.some((c) => c.id === ids[0]),
      hand: g.hand.map((c) => ({
        ...card(c),
        selected: (ids || []).includes(c.id),
      })),
      selectedCards: g.hand.filter((c) => (ids || []).includes(c.id)).map(card),
      future: turn ? (g.future || []).map(card) : [],
      direction: g.direction === -1 ? -1 : 1,
      directionText: g.direction === -1 ? "↺ 逆时针" : "↻ 顺时针",
      deckTop: g.deckTop?.type === "imploding" && g.deckTop.faceUp === true ? card(g.deckTop) : null,
      deckBottom: g.deckBottom?.type === "imploding" && g.deckBottom.faceUp === true ? card(g.deckBottom) : null,
      insertTitle: g.bomb?.type === "imploding" ? "首次抽到内爆猫 · 秘密插回" : "拆弹成功 · 秘密放回炸弹",
      insertHint: g.bomb?.type === "imploding" ? "无需拆弹，翻面插回。再次抽到直接出局，不能拆弹。位置只有你知道；放在牌顶或牌底时会公开危险提示。" : "位置只有你知道，其他牌的顺序不会改变。",
      targetLabel: base.selection.targetAttack ? "选择任一存活玩家（可选自己）" : "选择一位对手",
      discard: g.discard?.length ? card(g.discard[g.discard.length - 1]) : null,
      targets: ps.filter(
        (p) =>
          p.alive && (base.selection.targetAttack || (p.id !== id && (base.selection.needsNamed || p.count > 0))),
      ),
      positions: Array.from({ length: g.deckCount + 1 }, (_, i) => ({
        value: i + 1,
        label:
          i === 0
            ? "下一张（牌顶）"
            : i === g.deckCount
              ? "最底部"
              : `从牌顶数第 ${i + 1} 张`,
      })),
      winnerName: ps.find((p) => p.id === g.winner)?.name || "本局结束",
      pendingName: g.pending ? names[g.pending.type] || "同名组合" : "",
      detail:
        (ids || []).length === 1
          ? card(g.hand.find((c) => c.id === ids[0]) || { type: "cat1" })
          : null,
    };
  }
  function futureOrder(r, previous) {
    const g = r?.game;
    if (r?.status !== "playing" || g?.phase !== "alterFuture" || g.current !== me(r) || !g.players.some((p) => p.id === me(r) && p.alive) || !Array.isArray(g.future)) return null;
    const ids = g.future.map((c) => c.id);
    const key = JSON.stringify([r.code, g.id, g.current, ids]);
    const retained = previous?.key === key && previous.order.length === ids.length && new Set(previous.order).size === ids.length && previous.order.every((id) => ids.includes(id));
    const order = retained ? [...previous.order] : ids;
    return { key, order, cards: order.map((id, index) => ({ ...card(g.future.find((c) => c.id === id)), canUp: index > 0, canDown: index < order.length - 1 })), canConfirm: true };
  }
  function moveFuture(r, previous, id, delta) {
    const state = futureOrder(r, previous);
    if (!state || ![-1, 1].includes(delta)) return state;
    const index = state.order.indexOf(id), next = index + delta;
    if (index < 0 || next < 0 || next >= state.order.length) return state;
    [state.order[index], state.order[next]] = [state.order[next], state.order[index]];
    return futureOrder(r, state);
  }
  function contextChanged(a, b) {
    return (
      a?.game?.id !== b?.game?.id ||
      a?.game?.phase !== b?.game?.phase ||
      a?.game?.current !== b?.game?.current ||
      a?.game?.pending?.nopeCount !== b?.game?.pending?.nopeCount
    );
  }
  function nopeResponse(r, now = r?.serverNow ?? Date.now()) {
    const g = r?.game, p = g?.pending;
    if (r?.status !== "playing" || g?.phase !== "nope" || !p || !Number.isFinite(g.deadline))
      return null;
    const remaining = Math.max(0, Math.ceil((g.deadline - now) / 1000));
    const mine = g.players.find((player) => player.id === me(r));
    const nope = g.hand.find((c) => c.type === "nope");
    const actionName = p.type === "pair" ? "同名对子"
      : p.type === "triple" ? "三张组合" : names[p.type] || "卡牌效果";
    const canceled = p.nopeCount % 2 === 1;
    const status = p.responses?.[me(r)] || "waiting";
    const waiting = g.players.filter(player => player.alive && (!p.responses?.[player.id] || p.responses[player.id] === "waiting")).length;
    const canPass = !!mine?.alive && !!nope && status === "waiting" && remaining > 0;
    return {
      key: JSON.stringify([r.code, g.id, p.actor, p.type, p.nopeCount, g.deadline, p.actionId ?? null]),
      canNope: canPass && !!nope,
      canPass, status, waiting, nopeCount: p.nopeCount,
      done: !!mine?.alive && status !== "waiting",
      statusText: status === "passed" ? "已选择不出 · 本轮已完成" : status === "played" ? "已打出否定 · 本轮已完成" : !mine?.alive ? "正在旁观" : remaining === 0 ? "响应已结束 · 等待结算" : "",
      cardId: nope?.id,
      remaining: canPass ? remaining : 0,
      progress: Math.min(100, Math.max(0, (g.deadline - now) / ((r.options?.nopeSeconds ?? 10) * 1000) * 100)),
      actorName: r.players.find((player) => player.id === p.actor)?.name || "一位朋友",
      actionName,
      stateText: canceled ? "当前效果将被取消" : "当前效果将会生效",
      title: canceled ? "要打出反否定吗？" : "要打出否定吗？",
      buttonText: canceled ? "打出反否定" : "打出否定",
      resultText: `打出后：${canceled ? "恢复" : "取消"}「${actionName}」`,
    };
  }
  function nopePanel(r, now = r?.serverNow ?? Date.now()) {
    if (r?.status !== "playing" || !r.game || r.game.phase === "finished") return null;
    const info = nopeResponse(r, now);
    if (!info) return { active: false, key: "", canNope: false, canPass: false, done: false, remaining: 0, progress: 0, timerText: "", buttonText: "打出否定", statusText: "当前没有可响应的动作" };
    return { ...info, active: true, progress: info.canPass ? info.progress : 0,
      timerText: info.canPass ? `剩余 ${info.remaining} 秒` : info.status === "played" || (info.done && info.cardId) ? "已响应" : !info.cardId ? "" : info.statusText === "正在旁观" ? "正在旁观" : "等待结算" };
  }
  function actionPresentation(r, event) {
    function publicPlayer(id) {
      const seat = r.players?.find(p => p.id === id), p = r.game.players.find(p => p.id === id);
      if (!p && !seat) return null;
      const avatar = Number(p?.avatar ?? seat?.avatar ?? 0);
      return { id, name: p?.name || seat?.name || "玩家", avatar, avatarStyle: avatars[avatar % 4]?.style || avatars[0].style };
    }
    const actor = publicPlayer(event.actor), target = publicPlayer(event.target);
    const labels = [...new Set(event.cards.map(c => names[c.type] || c.type))].join(" + ");
    const quantity = event.cards.length > 1 ? ` ×${event.cards.length} 张` : "";
    const actionText = event.kind === "implode"
      ? event.cards[0].faceUp ? "抽到翻面内爆猫 · 立即出局" : "首次抽到内爆猫 · 翻面插回"
      : event.kind === "nope" ? `打出「${event.nopeCount % 2 ? "否定" : "反否定"}」· ${event.nopeCount % 2 ? "动作取消" : "动作恢复"}`
      : `打出「${labels}」${quantity}`;
    return { actor, target, relationship: `${actor?.name || "玩家"}${target ? " 向 " + target.name : ""}`, actionText };
  }
  function motion(previous, next) {
    const a = previous?.game,
      b = next?.game;
    if (!a || !b || a.id !== b.id) return null;
    if (a.phase !== b.phase) {
      if (b.phase === "defuse")
        return {
          kind: "bomb",
          title: "抽到炸弹猫",
          card: card({ type: "bomb" }),
        };
      if (b.phase === "insert" && b.bomb?.type === "imploding")
        return { kind: "bomb", title: "首次抽到内爆猫 · 翻面插回", card: card(b.bomb) };
      if (b.phase === "insert")
        return {
          kind: "defuse",
          title: "拆弹成功 · 秘密放回",
          card: card({ type: "defuse" }),
        };
      if (["future", "alterFuture"].includes(b.phase) && b.future && b.current === me(next))
        return { kind: "future", title: b.phase === "alterFuture" ? "秘密调整未来 · 确认后生效" : "只有你能看见预知" };
    }
    if (
      b.pending &&
      b.pending.nopeCount !== a.pending?.nopeCount &&
      b.pending.nopeCount > 0
    )
      return {
        kind: "nope",
        title: b.pending.nopeCount % 2 ? "动作已被否定" : "反否定 · 动作恢复",
        card: card({ type: "nope" }),
      };
    if (b.discard?.length > a.discard?.length) {
      const c = b.discard[b.discard.length - 1];
      const count = b.discard.length - (a.discard?.length || 0);
      const actor =
        b.players.find((p) => p.id === b.pending?.actor)?.name ||
        a.players.find((p) => p.id === a.current)?.name ||
        "玩家";
      return {
        kind: "play",
        ...actionPresentation(next, { kind: "play", actor: b.pending?.actor || a.current, target: b.pending?.target, cards: b.discard.slice(-count) }),
        title: `${actor}打出 · ${names[c.type]}${count > 1 ? " ×" + count : ""}`,
        count,
        card: card(c),
      };
    }
    const added = b.hand.find((c) => !a.hand.some((old) => old.id === c.id));
    if (added)
      return { kind: "draw", title: "获得一张新牌", card: card(added) };
    return null;
  }
  function motions(previous, next) {
    const a = previous?.game,
      b = next?.game;
    if (!a || !b || a.id !== b.id) return [];
    const last = Math.max(0, ...(a.logs || []).map((l) => l.id));
    const effects = (b.logs || [])
      .filter((l) => l.id > last && l.cardEvent)
      .map((l) => {
        const e = l.cardEvent;
        const actor = b.players.find((p) => p.id === e.actor)?.name || "玩家";
        const c = e.cards[0];
        return {
          kind: e.kind === "implode" ? "bomb" : e.kind,
          ...actionPresentation(next, e),
          count: e.cards.length,
          card: card(e.kind === "implode" ? { ...c, faceUp: true } : c),
          title:
            e.kind === "implode"
              ? `${actor}${c.faceUp ? "抽到翻面内爆猫 · 立即出局" : "首次抽到内爆猫 · 翻面插回"}`
              : e.kind === "nope"
              ? `${actor}${e.nopeCount % 2 ? "否定 · 动作取消" : "反否定 · 动作恢复"}`
              : `${actor}打出 · ${names[c.type]}${e.cards.length > 1 ? " ×" + e.cards.length : ""}`,
        };
      });
    const fallback = motion(previous, next);
    if (!effects.length) return fallback ? [fallback] : [];
    if (fallback && !["play", "nope"].includes(fallback.kind) && !effects.some((effect) => effect.kind === fallback.kind && effect.card?.type === fallback.card?.type))
      effects.push(fallback);
    return effects;
  }
  function createMotionPlayer({
    show,
    schedule = setTimeout,
    cancel = clearTimeout,
  }) {
    const queue = [];
    let timer = null,
      current = null,
      generation = 0;
    function next() {
      current = queue.shift() || null;
      show(current);
      if (!current) {
        timer = null;
        return;
      }
      const token = generation;
      const duration =
        current.kind === "draw" || current.kind === "future" ? 1600 : 5000;
      timer = schedule(() => {
        if (token === generation) next();
      }, duration);
    }
    return {
      push(effect) {
        if (!effect) return;
        queue.push(effect);
        if (!current) next();
      },
      clear() {
        generation++;
        if (timer !== null) cancel(timer);
        timer = null;
        current = null;
        queue.length = 0;
        show(null);
      },
    };
  }
  // Minimal wx.setData paths keep unchanged image bindings out of the bridge.
  function dataPatch(previous, update) {
    const patch = {};
    function visit(before, after, path) {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) {
        patch[path] = after;
        return;
      }
      if (Array.isArray(after)) {
        if (before.length !== after.length || after.some((item, i) => (item?.id ?? item?.renderId) !== (before[i]?.id ?? before[i]?.renderId))) patch[path] = after;
        else after.forEach((item, i) => visit(before[i], item, `${path}[${i}]`));
        return;
      }
      const keys = Object.keys(after);
      if (Object.keys(before).some(key => !Object.prototype.hasOwnProperty.call(after, key)) || keys.some(key => !/^[A-Za-z_$][\w$]*$/.test(key))) {
        patch[path] = after;
        return;
      }
      keys.forEach(key => visit(before[key], after[key], `${path}.${key}`));
    }
    Object.keys(update).forEach(key => visit(previous[key], update[key], key));
    return patch;
  }
  return {
    dataPatch,
    names,
    card,
    namedOptions,
    futureOrder,
    moveFuture,
    avatars,
    selection,
    derive,
    me,
    contextChanged,
    nopeResponse,
    nopePanel,
    motion,
    motions,
    createMotionPlayer,
  };
});
