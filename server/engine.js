"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const { CARDS, TYPES, BASE_TYPES, EXPANSION_TYPES, isHazard, validCombo } = require("../shared/cards");
const RULES = {
  action: 30000,
  nope: 10000,
  favor: 15000,
  future: 10000,
  alterFuture: 10000,
  defuse: 10000,
  insert: 15000,
};
class GameError extends Error {
  constructor(message, code = "INVALID_ACTION") {
    super(message);
    this.code = code;
  }
}
const fail = (message) => {
  throw new GameError(message);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const random = () => randomInt(0, 0x100000000) / 0x100000000;
function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function player(g, id) {
  return g.players.find((p) => p.id === id) || fail("玩家不在此对局中");
}
function log(g, text, cardEvent = null) {
  g.logs.push({ id: ++g.eventId, text, ...(cardEvent ? { cardEvent } : {}) });
  g.logs = g.logs.slice(-30);
}
function privateLog(g, id, text) {
  g.privateLogs[id] ||= [];
  g.privateLogs[id].push({ id: ++g.eventId, text });
  g.privateLogs[id] = g.privateLogs[id].slice(-8);
}
function phase(g, name, now) {
  g.phase = name;
  const duration = name === "nope"
    ? (g.options?.nopeSeconds ?? 10) * 1000
    : RULES[name];
  g.deadline =
    (g.options?.noTurnTimer && name !== "nope") || (name === "nope" && duration === 0)
      ? null
      : now + duration;
}
function responseState(g) {
  return Object.fromEntries(g.players.filter(p => p.alive).map(p => {
    const status = g.pending.responses?.[p.id];
    return [p.id, status && status !== "waiting" ? status
      : p.hand.some(c => c.type === "nope") ? "waiting" : "passed"];
  }));
}
function responses(g) { return g.pending.responses = responseState(g); }
function nopeWindow(g, code) {
  const p = g?.pending;
  return g?.phase === "nope" && p
    ? JSON.stringify([code, g.id, p.actor, p.type, p.nopeCount, g.deadline, p.actionId ?? null]) : null;
}
function openNope(g, now, rng, playedBy = null) {
  g.pending.responses = Object.fromEntries(
    g.players.filter(p => p.alive).map(p => [p.id, p.id === playedBy ? "played"
      : p.hand.some(c => c.type === "nope") ? "waiting" : "passed"]),
  );
  phase(g, "nope", now);
  if (!Object.values(g.pending.responses).includes("waiting")) resolve(g, now, rng);
}
function checkResponse(g, id, a) {
  if (g.phase !== "nope") fail("现在没有可否定的动作");
  if (a.nopeCount !== undefined && a.nopeCount !== g.pending.nopeCount)
    throw new GameError("响应窗口已变化，请查看当前提示", "STALE");
  if (responses(g)[id] !== "waiting") fail("本轮已完成选择，请等待其他玩家");
}
function resume(g, now) {
  g.pending = null;
  g.future = null;
  g.phase = "action";
  g.deadline = g.options?.noTurnTimer ? null : now + g.budget;
}
function next(g, id) {
  const i = g.players.findIndex((p) => p.id === id);
  for (let k = 1; k <= g.players.length; k++) {
    const p = g.players[(i + k * (g.direction || 1) + g.players.length) % g.players.length];
    if (p.alive) return p.id;
  }
  fail("没有存活玩家");
}
function endTurn(g, now) {
  g.turnNumber = (g.turnNumber || 0) + 1;
  g.remaining--;
  if (g.remaining <= 0) {
    g.current = next(g, g.current);
    g.remaining = 1;
    g.attacked = false;
  }
  g.budget = RULES.action;
  resume(g, now);
}
function remove(p, id) {
  const i = p.hand.findIndex((c) => c.id === id);
  if (i < 0) fail("这张牌不在你的手中");
  return p.hand.splice(i, 1)[0];
}
function createGame(
  players,
  {
    rng = random,
    now = Date.now(),
    id = randomUUID(),
    noTurnTimer = false,
    nopeSeconds = 10,
    allowNopeChain = true,
    includeImploding = true,
    includeReverse = true,
  } = {},
) {
  if (typeof includeImploding !== "boolean" || typeof includeReverse !== "boolean") fail("扩展规则设置必须为布尔值");
  if (typeof allowNopeChain !== "boolean") fail("可循环否定设置必须为布尔值");
  // 5/15 remain valid only for games restored from old rooms.
  if (![0, 5, 10, 15, 20, 30].includes(nopeSeconds)) fail("否定时长请选择10、20、30秒或不限时");
  if (
    players.length < 2 ||
    players.length > 6 ||
    new Set(players.map((p) => p.id)).size !== players.length
  )
    fail("需要 2–6 名不同玩家");
  let serial = 0;
  const make = (type) => ({ id: id + ":" + serial++, type });
  const n = players.length;
  const ps = players.map((p) => ({
    ...p,
    alive: true,
    hand: [make("defuse")],
  }));
  const deck = [];
  for (const type of (n === 6 ? TYPES : BASE_TYPES)) {
    if (isHazard(type) || type === "defuse" || (type === "reverse" && !includeReverse)) continue;
    for (let i = 0; i < CARDS[type].count; i++) deck.push(make(type));
  }
  for (let i = 0; i < Math.min(2, 6 - n); i++) deck.push(make("defuse"));
  shuffle(deck, rng);
  for (const p of ps) p.hand.push(...deck.splice(0, 7));
  for (let i = 0; i < (n === 6 && includeImploding ? 4 : n - 1); i++) deck.push(make("bomb"));
  if (n === 6 && includeImploding) deck.push(make("imploding"));
  shuffle(deck, rng);
  const g = {
    id,
    version: 1,
    rulesVersion: n === 6 ? "ek-imploding-2023-online-v1" : "ek-original-2025-online-v1",
    options: { noTurnTimer: noTurnTimer === true, nopeSeconds, allowNopeChain, includeImploding, includeReverse },
    players: ps,
    deck,
    discard: [],
    exploded: [],
    bomb: null,
    pending: null,
    future: null,
    current: ps[Math.floor(rng() * n)].id,
    remaining: 1,
    turnNumber: 1,
    attacked: false,
    direction: 1,
    budget: RULES.action,
    phase: "action",
    deadline: noTurnTimer === true ? null : now + RULES.action,
    winner: null,
    logs: [],
    privateLogs: {},
    eventId: 0,
    totalCards: serial,
  };
  log(g, "对局开始，抽牌会结束一个回合。");
  assertInvariant(g);
  return g;
}
function draw(g, now, fromBottom = false) {
  const p = player(g, g.current);
  if (!g.deck.length) fail("牌堆异常为空");
  const card = fromBottom ? g.deck.pop() : g.deck.shift();
  if (!isHazard(card.type)) {
    p.hand.push(card);
    privateLog(g, p.id, "抽到「" + CARDS[card.type].name + "」");
    log(g, p.name + (fromBottom ? " 从牌底抽了 1 张牌" : " 抽了 1 张牌"));
    endTurn(g, now);
    return;
  }
  g.bomb = card;
  if (card.type === "imploding") {
    log(g, p.name + (card.faceUp ? " 抽到了翻面的内爆猫，无法拆弹" : " 首次抽到内爆猫，翻面后秘密放回"), {
      kind: "implode", actor: p.id, cards: [clone(card)],
    });
    if (!card.faceUp) {
      card.faceUp = true;
      phase(g, "insert", now);
      return;
    }
  } else {
    log(g, p.name + " 抽到了炸弹猫");
    if (p.hand.some(c => c.type === "defuse")) {
      phase(g, "defuse", now);
      return;
    }
  }
  eliminate(g, p, now);
}
function eliminate(g, p, now) {
  p.alive = false;
  g.exploded.push(g.bomb);
  g.bomb = null;
  log(g, p.name + " 爆炸出局，手牌已封存");
  const alive = g.players.filter((x) => x.alive);
  if (alive.length === 1) {
    g.winner = alive[0].id;
    g.phase = "finished";
    g.deadline = null;
    g.pending = null;
    log(g, alive[0].name + " 成为最后的幸存者");
  } else {
    g.remaining = 1;
    endTurn(g, now);
  }
}
function defuse(g, now) {
  const p = player(g, g.current);
  const c = p.hand.find((c) => c.type === "defuse");
  if (!c) fail("没有拆弹牌");
  g.discard.push(remove(p, c.id));
  log(g, p.name + " 使用了拆弹");
  phase(g, "insert", now);
}
function insert(g, position, now) {
  if (
    !Number.isInteger(position) ||
    position < 1 ||
    position > g.deck.length + 1
  )
    fail("插回位置不合法");
  const name = CARDS[g.bomb.type].name;
  g.deck.splice(position - 1, 0, g.bomb);
  g.bomb = null;
  privateLog(g, g.current, name + "放回牌顶第 " + position + " 张");
  log(g, player(g, g.current).name + " 已秘密放回" + name);
  endTurn(g, now);
}
function transfer(g, from, to, id) {
  const c = remove(player(g, from), id);
  player(g, to).hand.push(c);
  privateLog(g, from, "交出「" + CARDS[c.type].name + "」");
  privateLog(g, to, "获得「" + CARDS[c.type].name + "」");
  log(g, player(g, from).name + " 向 " + player(g, to).name + " 交出 1 张牌");
}
function resolve(g, now, rng) {
  const a = g.pending;
  if (a.nopeCount % 2) {
    log(g, "动作被否定，已出的牌不退回");
    resume(g, now);
    return;
  }
  if (a.type === "attack" || a.type === "targetAttack") {
    g.turnNumber = (g.turnNumber || 0) + 1;
    g.remaining = (g.attacked ? g.remaining : 0) + 2;
    g.attacked = true;
    g.current = a.type === "targetAttack" ? a.target : next(g, g.current);
    g.budget = RULES.action;
    log(g, player(g, g.current).name + " 需要完成 " + g.remaining + " 个回合");
    resume(g, now);
  } else if (a.type === "reverse") {
    if (g.players.filter(p => p.alive).length > 2) g.direction = -(g.direction || 1);
    log(g, "反转生效，结束一个回合");
    endTurn(g, now);
  } else if (a.type === "bottom") draw(g, now, true);
  else if (a.type === "skip") endTurn(g, now);
  else if (a.type === "shuffle") {
    shuffle(g.deck, rng);
    log(g, "剩余牌堆已重新洗匀");
    resume(g, now);
  } else if (a.type === "future" || a.type === "alterFuture") {
    g.future = g.deck.slice(0, 3);
    phase(g, a.type, now);
  } else if (a.type === "favor") {
    phase(g, "favor", now);
  } else if (a.type === "pair" || a.type === "triple") {
    const target = player(g, a.target);
    const c =
      a.type === "pair"
        ? target.hand[Math.floor(rng() * target.hand.length)]
        : target.hand.find((c) => c.type === a.named);
    if (c) transfer(g, a.target, a.actor, c.id);
    else log(g, "对方没有声明的牌，组合未获得手牌");
    resume(g, now);
  }
}
function play(g, id, a, now, rng) {
  const p = player(g, id);
  if (
    !Array.isArray(a.cards) ||
    a.cards.length < 1 ||
    a.cards.length > 3 ||
    new Set(a.cards).size !== a.cards.length
  )
    fail("请选择 1 张行动牌或 2–3 张同名牌");
  const cards = a.cards.map(
    (cid) => p.hand.find((c) => c.id === cid) || fail("这张牌不在你的手中"),
  );
  const kind = cards[0].type;
  if (isHazard(kind) || (cards.length > 1 && !validCombo(cards)))
    fail("组合必须同名，野猫只能替代同一种普通猫");
  if (cards.some(c => CARDS[c.type]?.expansion) && g.rulesVersion !== "ek-imploding-2023-online-v1")
    fail("本局未启用内爆猫扩展");
  if (cards.some(c => c.type === "reverse") && g.options?.includeReverse === false) fail("本局未启用反转");
  let type = kind;
  if (
    cards.length === 1 &&
    !["attack", "skip", "favor", "shuffle", "future", "targetAttack", "reverse", "bottom", "alterFuture"].includes(kind)
  )
    fail(
      kind === "nope"
        ? "否定只能在响应窗口使用"
        : kind === "defuse"
          ? "拆弹只能在抽到炸弹后使用"
          : "普通猫需要同名组合",
    );
  if (cards.length === 2) type = "pair";
  if (cards.length === 3) type = "triple";
  if (["favor", "pair", "triple", "targetAttack"].includes(type)) {
    const t = player(g, a.target);
    if (!t.alive || (type !== "targetAttack" && t.id === id)) fail("请选择另一名存活玩家");
    if (["favor", "pair"].includes(type) && !t.hand.length) fail("这位玩家没有手牌");
    if (type === "triple" && (!TYPES.includes(a.named) || isHazard(a.named) || (a.named === "reverse" && g.options?.includeReverse === false) || (EXPANSION_TYPES.includes(a.named) && g.rulesVersion !== "ek-imploding-2023-online-v1")))
      fail("请选择要索取的牌名");
  }
  if (g.deadline !== null) g.budget = Math.max(0, g.deadline - now);
  g.discard.push(...cards.map((c) => remove(p, c.id)));
  g.pending = {
    actor: id,
    type,
    target: ["favor", "pair", "triple", "targetAttack"].includes(type) ? a.target : null,
    named: type === "triple" ? a.named : null,
    count: cards.length,
    nopeCount: 0,
  };
  log(
    g,
    p.name +
      " 使用了 " +
      (type === "pair"
        ? "同名对子"
        : type === "triple"
          ? "三张组合，点名「" + CARDS[a.named].name + "」"
          : CARDS[kind].name),
    {
      kind: "play",
      actor: id,
      target: type === "attack" ? next(g, id) : g.pending.target,
      cards: cards.map((c) => ({ id: c.id, type: c.type })),
    },
  );
  g.pending.actionId = g.eventId;
  openNope(g, now, rng);
}
function command(state, id, a, { now = Date.now(), rng = random } = {}) {
  const g = clone(state);
  const p = player(g, id);
  if (!p.alive || g.phase === "finished") fail("你现在不能操作");
  if (g.deadline !== null && now >= g.deadline)
    throw new GameError("操作窗口已结束，请刷新", "STALE");
  if (a.type === "nope") {
    checkResponse(g, id, a);
    const c = p.hand.find((c) => c.id === a.cardId);
    if (!c || c.type !== "nope") fail("请选择否定牌");
    g.discard.push(remove(p, c.id));
    g.pending.nopeCount++;
    log(
      g,
      p.name +
        (g.pending.nopeCount % 2 ? " 否定了这个动作" : " 反否定，动作恢复"),
      {
        kind: "nope",
        actor: id,
        target: g.pending.lastNopeActor || g.pending.actor,
        cards: [{ id: c.id, type: c.type }],
        nopeCount: g.pending.nopeCount,
      },
    );
    g.pending.lastNopeActor = id;
    if (g.options?.allowNopeChain === false) resolve(g, now, rng);
    else openNope(g, now, rng, id);
  } else if (a.type === "passNope") {
    if (!Number.isInteger(a.nopeCount)) fail("请选择当前否定窗口");
    checkResponse(g, id, a);
    responses(g)[id] = "passed";
    if (Object.values(responses(g)).every(status => status !== "waiting"))
      resolve(g, now, rng);
  } else if (g.phase === "favor" && a.type === "give") {
    if (g.pending.target !== id) fail("请等待对方交牌");
    transfer(g, id, g.pending.actor, a.cardId);
    resume(g, now);
  } else {
    if (id !== g.current) fail("还没有轮到你");
    if (g.phase === "action") {
      if (a.type === "draw") draw(g, now);
      else if (a.type === "play") play(g, id, a, now, rng);
      else fail("此阶段不支持该操作");
    } else if (g.phase === "defuse" && a.type === "defuse") defuse(g, now);
    else if (g.phase === "insert" && a.type === "insert")
      insert(g, a.position, now);
    else if (g.phase === "future" && a.type === "closeFuture") resume(g, now);
    else if (g.phase === "alterFuture" && a.type === "orderFuture") {
      const ids = g.future.map(c => c.id);
      if (!Array.isArray(a.order) || a.order.length !== ids.length || new Set(a.order).size !== ids.length || a.order.some(cid => !ids.includes(cid)))
        fail("请确认牌顶全部卡牌的完整排列");
      g.deck.splice(0, ids.length, ...a.order.map(cid => g.future.find(c => c.id === cid)));
      privateLog(g, id, "已调整牌顶顺序");
      log(g, p.name + " 已确认牌顶顺序");
      resume(g, now);
    }
    else fail("请先完成当前阶段");
  }
  g.version++;
  return g;
}
function tick(state, { now = Date.now(), rng = random } = {}) {
  if (state.phase === "nope") {
    const g = clone(state);
    if (!Object.values(responses(g)).includes("waiting")) {
      resolve(g, now, rng);
      g.version++;
      return g;
    }
  }
  if (
    state.phase === "finished" ||
    state.deadline === null ||
    now < state.deadline
  )
    return state;
  const g = clone(state);
  switch (g.phase) {
    case "action":
      draw(g, now);
      break;
    case "nope":
      resolve(g, now, rng);
      break;
    case "defuse":
      defuse(g, now);
      break;
    case "insert":
      insert(g, 1 + Math.floor(rng() * (g.deck.length + 1)), now);
      break;
    case "future":
    case "alterFuture":
      resume(g, now);
      break;
    case "favor": {
      const p = player(g, g.pending.target);
      if (p.hand.length)
        transfer(
          g,
          p.id,
          g.pending.actor,
          p.hand[Math.floor(rng() * p.hand.length)].id,
        );
      resume(g, now);
      break;
    }
    default:
      fail("未知阶段");
  }
  g.version++;
  return g;
}
function project(g, id) {
  const p = player(g, id);
  const view = {
    id: g.id,
    version: g.version,
    phase: g.phase,
    rulesVersion: g.rulesVersion,
    options: clone(g.options || {}),
    direction: g.direction || 1,
    current: g.current,
    remaining: g.remaining,
    turnNumber: g.turnNumber || 0,
    attacked: g.attacked,
    deadline: g.deadline,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: !!p.isBot,
      alive: p.alive,
      count: p.hand.length,
    })),
    hand: clone(p.hand),
    deckCount: g.deck.length,
    deckTop: g.deck[0]?.type === "imploding" && g.deck[0].faceUp ? clone(g.deck[0]) : null,
    deckBottom: g.deck.at(-1)?.type === "imploding" && g.deck.at(-1).faceUp ? clone(g.deck.at(-1)) : null,
    discard: clone(g.discard),
    pending: g.phase === "nope"
      ? { ...clone(g.pending), responses: responseState(g) }
      : clone(g.pending),
    winner: g.winner,
    logs: clone(g.logs),
    privateLog: clone(g.privateLogs[id] || []),
  };
  if (["future", "alterFuture"].includes(g.phase) && g.current === id) view.future = clone(g.future);
  if (g.bomb) view.bomb = clone(g.bomb);
  return view;
}
function assertInvariant(g) {
  const cards = [
    ...g.deck,
    ...g.discard,
    ...g.exploded,
    ...g.players.flatMap((p) => p.hand),
    ...(g.bomb ? [g.bomb] : []),
  ];
  if (
    cards.length !== g.totalCards ||
    new Set(cards.map((c) => c.id)).size !== g.totalCards
  )
    fail("卡牌守恒校验失败");
  const bombs =
    g.deck.filter((c) => isHazard(c.type)).length + (g.bomb ? 1 : 0);
  if (bombs !== g.players.filter((p) => p.alive).length - 1)
    fail("炸弹数量校验失败");
  if (g.players.some((p) => p.hand.some((c) => isHazard(c.type))))
    fail("手牌中出现炸弹");
  return true;
}
module.exports = {
  createGame,
  command,
  tick,
  project,
  assertInvariant,
  GameError,
  RULES,
  nopeWindow,
};
