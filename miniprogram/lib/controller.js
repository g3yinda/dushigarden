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
    cat1: "困困猫",
    cat2: "饭团猫",
    cat3: "宇航猫",
    cat4: "侦探猫",
    cat5: "摇滚猫",
  };
  const descriptions = {
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
    bomb: "抽到就爆炸",
    defuse: "抵消一次爆炸",
    attack: "下家行动 2 回合",
    skip: "免抽，结束 1 回合",
    favor: "对方选牌给你",
    shuffle: "打乱剩余牌堆",
    future: "偷看牌顶 3 张",
    nope: "取消或恢复动作",
  };
  function card(c) {
    const [x, y, w, h] = crops[c.type] || crops.cat1;
    return {
      ...c,
      name: names[c.type] || c.type,
      description:
        descriptions[c.type] ||
        "单张无效果。两张同名随机取牌；三张同名声明一种牌并向对手索取。",
      short: shorts[c.type] || "同名组合偷牌",
      source: c.type.startsWith("cat") ? "cats.jpg" : "core.jpg",
      art: `width:${153600 / w}%;left:${(-100 * x) / w}%;top:${(-100 * y * 1.38) / w}%;`,
      symbol: "",
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
          ["attack", "skip", "favor", "shuffle", "future"].includes(t) &&
          (t !== "favor" ||
            g.players.some((p) => p.alive && p.id !== me(r) && p.count > 0)),
        needsTarget: t === "favor",
        hint: t.startsWith("cat")
          ? "普通猫需要两张或三张同名组合"
          : t === "nope"
            ? "否定只能在响应窗口单张使用"
            : result.hint,
      };
    }
    if (cards.length > 3 || cards.some((c) => c.type !== cards[0].type))
      return { ...result, hint: "组合需要两张或三张同名牌" };
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
      defuse: turn ? "拆弹，安全第一" : "对方正在拆弹",
      insert: turn ? "秘密放回炸弹" : "对方正在放回炸弹",
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
      future: (g.future || []).map(card),
      discard: g.discard?.length ? card(g.discard[g.discard.length - 1]) : null,
      targets: ps.filter(
        (p) =>
          p.alive && p.id !== id && (base.selection.needsNamed || p.count > 0),
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
    const canPass = !!mine?.alive && status === "waiting" && remaining > 0;
    return {
      key: JSON.stringify([r.code, g.id, p.actor, p.type, p.nopeCount, g.deadline]),
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
      if (b.phase === "insert")
        return {
          kind: "defuse",
          title: "拆弹成功 · 秘密放回",
          card: card({ type: "defuse" }),
        };
      if (b.phase === "future" && b.future)
        return { kind: "future", title: "只有你能看见预知" };
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
          kind: e.kind,
          count: e.cards.length,
          card: card(c),
          title:
            e.kind === "nope"
              ? `${actor}${e.nopeCount % 2 ? "否定 · 动作取消" : "反否定 · 动作恢复"}`
              : `${actor}打出 · ${names[c.type]}${e.cards.length > 1 ? " ×" + e.cards.length : ""}`,
        };
      });
    const fallback = motion(previous, next);
    if (!effects.length) return fallback ? [fallback] : [];
    if (fallback && !["play", "nope"].includes(fallback.kind))
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
        current.kind === "draw" || current.kind === "future" ? 1600 : 3000;
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
  return {
    names,
    card,
    avatars,
    selection,
    derive,
    me,
    contextChanged,
    nopeResponse,
    motion,
    motions,
    createMotionPlayer,
  };
});
