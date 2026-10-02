const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RoomService } = require("../server/rooms");
const E = require("../server/engine");
let bots = {};
try {
  bots = require("../server/bots");
} catch (e) {
  if (e.code !== "MODULE_NOT_FOUND") throw e;
}
function view(phase = "action") {
  return {
    me: "b",
    players: [
      { id: "a", isBot: false },
      { id: "b", isBot: true },
    ],
    game: {
      id: "g",
      version: 1,
      phase,
      current: "b",
      remaining: 1,
      attacked: false,
      deadline: 30000,
      players: [
        { id: "a", alive: true, count: 3, isBot: false },
        { id: "b", alive: true, count: 4, isBot: true },
      ],
      hand: [
        { id: "d", type: "defuse" },
        { id: "s", type: "skip" },
        { id: "c1", type: "cat1" },
        { id: "c2", type: "cat1" },
      ],
      deckCount: 10,
      pending: null,
    },
  };
}
function command(s, id, r, type, payload = {}) {
  return s.command(id, r.code, {
    commandId: crypto.randomUUID(),
    revision: r.revision,
    gameId: r.game?.id,
    type,
    ...payload,
  });
}
test("Bot 策略先存在并只提交合法可见动作", () => {
  assert.equal(typeof bots.chooseAction, "function");
  const a = bots.chooseAction(view(), { rng: () => 0, played: 0 });
  assert.equal(a.type, "play");
  assert(a.cards.every((id) => view().game.hand.some((c) => c.id === id)));
  assert.equal(bots.chooseAction(view(), { played: 1 }).type, "draw");
  const r = view();
  r.game.current = "a";
  assert.equal(bots.chooseAction(r), null);
  r.game.current = "b";
  r.game.players[1].alive = false;
  assert.equal(bots.chooseAction(r), null);
});
test("Bot 私密阶段可以交牌、拆弹、插回与看完预知", () => {
  assert.equal(typeof bots.chooseAction, "function");
  const r = view("favor");
  r.game.pending = { target: "b" };
  assert.equal(bots.chooseAction(r).type, "give");
  assert.notEqual(bots.chooseAction(r).cardId, "d");
  r.game.pending.target = "a";
  assert.equal(bots.chooseAction(r), null);
  assert.deepEqual(bots.chooseAction(view("defuse")), { type: "defuse" });
  for (const random of [0, 0.5, 0.999]) {
    const a = bots.chooseAction(view("insert"), { rng: () => random });
    assert.equal(a.type, "insert");
    assert(a.position >= 1 && a.position <= 11);
  }
  assert.deepEqual(bots.chooseAction(view("future")), { type: "closeFuture" });
});
test("Bot 不出也确认本层，开启时能够否定与反否定", () => {
  assert.equal(typeof bots.chooseAction, "function");
  const r = view("nope");
  r.game.hand.push({ id: "n", type: "nope" });
  r.game.pending = { actor: "a", type: "attack", nopeCount: 0 };
  assert.deepEqual(bots.chooseAction(r, { respondNope: false }), {type:"passNope",nopeCount:0});
  assert.deepEqual(bots.chooseAction(r, { respondNope: true }), {
    type: "nope",
    cardId: "n",
    nopeCount: 0,
  });
  r.game.pending = { actor: "b", type: "attack", nopeCount: 1 };
  assert.equal(bots.chooseAction(r, { respondNope: true }).type, "nope");
  r.game.pending.nopeCount = 0;
  assert.deepEqual(bots.chooseAction(r, { respondNope: true }), {type:"passNope",nopeCount:0});
  r.game.pending.responses = {b:"passed"};
  assert.equal(bots.chooseAction(r, { respondNope: true }), null);
});
test("普通猫同名组合可以出牌且目标只选公开有牌对手", () => {
  assert.equal(typeof bots.chooseAction, "function");
  const r = view();
  r.game.hand = r.game.hand.filter((c) => c.type !== "skip");
  const a = bots.chooseAction(r, { rng: () => 0 });
  assert.equal(a.type, "play");
  assert.equal(a.cards.length, 2);
  assert.equal(a.target, "a");
  r.game.players[0].count = 0;
  assert.equal(bots.chooseAction(r, { rng: () => 0 }).type, "draw");
});
test("正式 RoomService 拒绝 Bot，房主添加后自动准备、重复添加不重复占位", () => {
  const no = new RoomService();
  const p = no.session({ name: "甲" }).player;
  let r = no.create(p.id);
  assert.throws(
    () => command(no, p.id, r, "addBots", { count: 1, respondNope: false }),
    (e) => e.status === 403,
  );
  const s = new RoomService({ allowBots: true, now: () => 1000 });
  const h = s.session({ name: "甲" }).player;
  r = s.create(h.id);
  const a = {
    type: "addBots",
    count: 2,
    respondNope: false,
    revision: r.revision,
    commandId: "bot-once",
  };
  r = s.command(h.id, r.code, a);
  assert.equal(r.players.length, 3);
  assert.equal(r.hostId, h.id);
  assert(r.players.filter((p) => p.isBot).every((p) => p.ready));
  assert.equal(s.command(h.id, r.code, a).players.length, 3);
  assert.throws(() =>
    command(s, h.id, r, "addBots", { count: 4, respondNope: false }),
  );
  const bot = r.players.find((p) => p.isBot);
  assert.throws(() =>
    command(s, bot.id, r, "addBots", { count: 1, respondNope: false }),
  );
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  assert.equal(r.game.hand.length, 8);
  assert.equal(r.game.players.filter((p) => p.isBot).length, 2);
  assert.throws(() =>
    command(s, h.id, r, "addBots", { count: 1, respondNope: false }),
  );
});
test("真人离开准备页后清理 Bot，真人断线时 Bot 不成为房主或阻止五分钟中止", () => {
  let now = 1000;
  const s = new RoomService({ allowBots: true, now: () => now });
  const h = s.session({ name: "人" }).player;
  let r = s.create(h.id);
  r = command(s, h.id, r, "addBots", { count: 1, respondNope: false });
  r = command(s, h.id, r, "leave");
  assert.equal(r, null);
  assert.equal(Object.keys(s.rooms).length, 0);
  r = s.create(h.id);
  r = command(s, h.id, r, "addBots", { count: 1, respondNope: false });
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  command(s, h.id, r, "leave");
  s.tick();
  assert.equal(s.rooms[r.code].hostId, h.id);
  now += 300001;
  s.tick();
  assert.equal(s.rooms[r.code].status, "aborted");
  assert.equal(s.rooms[r.code].game.winner, null);
});
test("BotRunner 使用投影，1.5 秒思考并且无真人在线时暂停", () => {
  assert.equal(typeof bots.BotRunner, "function");
  let now = 1000;
  const s = new RoomService({ allowBots: true, now: () => now });
  const h = s.session({ name: "人" }).player;
  let r = s.create(h.id);
  r = command(s, h.id, r, "addBots", { count: 1, respondNope: false });
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  const b = r.players.find((p) => p.isBot);
  s.rooms[r.code].game.current = b.id;
  const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0.99 });
  const revision = s.rooms[r.code].revision;
  runner.step();
  assert.equal(s.rooms[r.code].revision, revision);
  now += 1499;
  runner.step();
  assert.equal(s.rooms[r.code].revision, revision);
  now++;
  runner.step();
  assert(s.rooms[r.code].revision > revision);
  command(s, h.id, s.view(h.id, r.code), "leave");
  const after = s.rooms[r.code].revision;
  now += 5000;
  runner.step();
  assert.equal(s.rooms[r.code].revision, after);
});
test("一只 Bot 行动不会清除同房其他 Bot 的回合记忆", () => {
  let now = 1000;
  const s = new RoomService({ allowBots: true, now: () => now });
  const h = s.session({ name: "人" }).player;
  let r = s.create(h.id);
  r = command(s, h.id, r, "addBots", { count: 2, respondNope: false });
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  const seats = r.players.filter((p) => p.isBot);
  s.rooms[r.code].game.current = seats[0].id;
  const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0.99 });
  runner.step();
  now += 1500;
  runner.step();
  assert(runner.memory.has(r.code + ":" + seats[1].id));
});
test("同一 Bot 回合暂停重连后保留出牌记忆，恢复时重新思考再抽牌", () => {
  let now = 1000;
  const s = new RoomService({ allowBots: true, now: () => now });
  const h = s.session({ name: "人" }).player;
  let r = s.create(h.id);
  r = command(s, h.id, r, "addBots", { count: 1, respondNope: false });
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  const b = r.players.find((p) => p.isBot);
  const g = s.rooms[r.code].game;
  const hand = g.players.find((p) => p.id === b.id).hand;
  for (const type of ["future", "shuffle"]) {
    const source = [g.deck, ...g.players.map((p) => p.hand)].find((cards) =>
      cards.some((c) => c.type === type),
    );
    const index = source.findIndex((c) => c.type === type);
    hand.unshift(source.splice(index, 1)[0]);
  }
  const humanHand = g.players.find(p => p.id === h.id).hand;
  if (!humanHand.some(c => c.type === "nope")) {
    const source = [g.deck, ...g.players.map(p => p.hand)].find(cards => cards.some(c => c.type === "nope"));
    humanHand.push(source.splice(source.findIndex(c => c.type === "nope"), 1)[0]);
  }
  g.current = b.id;
  g.deck.sort((a, b) => (a.type === "bomb") - (b.type === "bomb"));
  const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0 });
  runner.step();
  now += 1500;
  runner.step();
  assert.equal(s.rooms[r.code].game.pending.type, "shuffle");
  now += E.RULES.nope + 1;
  s.tick();
  assert.equal(s.rooms[r.code].game.phase, "action");
  // The shuffle effect uses production randomness; keep only subsequent fixture draws deterministic.
  s.rooms[r.code].game.deck.sort(
    (a, b) => (a.type === "bomb") - (b.type === "bomb"),
  );
  command(s, h.id, s.view(h.id, r.code), "leave");
  runner.step();
  now += 1000;
  s.touch(h.id, s.rooms[r.code]);
  const revision = s.rooms[r.code].revision;
  runner.step();
  assert.equal(s.rooms[r.code].revision, revision);
  now += 1499;
  runner.step();
  assert.equal(s.rooms[r.code].revision, revision);
  now++;
  runner.step();
  assert(s.rooms[r.code].revision > revision);
  assert.notEqual(s.rooms[r.code].game.phase, "nope");
  assert(
    !s.rooms[r.code].game.logs.some((log) => log.text.includes("使用了 预知")),
  );
  E.assertInvariant(s.rooms[r.code].game);
  command(s, h.id, s.view(h.id, r.code), "draw");
  runner.step();
  now += 1500;
  runner.step();
  assert.equal(
    s.rooms[r.code].game.phase,
    "nope",
    "下一轮 Bot 可以重新主动出牌",
  );
});
test("进行中的 Bot 预知阶段从快照恢复后自动关闭并继续抽牌", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boom-active-bot-"));
  try {
    let now = 1000;
    const file = path.join(dir, "state.json");
    const s = new RoomService({ allowBots: true, file, now: () => now });
    const h = s.session({ name: "人" }).player;
    let r = s.create(h.id);
    r = command(s, h.id, r, "addBots", { count: 1, respondNope: false });
    r = command(s, h.id, r, "ready", { ready: true });
    r = command(s, h.id, r, "start");
    const b = r.players.find((p) => p.isBot);
    const g = s.rooms[r.code].game;
    const hand = g.players.find((p) => p.id === b.id).hand;
    const source = [g.deck, ...g.players.map((p) => p.hand)].find((cards) =>
      cards.some((c) => c.type === "future"),
    );
    hand.unshift(
      source.splice(
        source.findIndex((c) => c.type === "future"),
        1,
      )[0],
    );
    // This scenario waits through a Nope window. Random deals without a
    // human Nope resolve Future immediately and its own timer then expires.
    const humanHand = g.players.find((p) => p.id === h.id).hand;
    if (!humanHand.some((c) => c.type === "nope")) {
      const nopeSource = [g.deck, hand].find((cards) => cards.some((c) => c.type === "nope"));
      humanHand.push(nopeSource.splice(nopeSource.findIndex((c) => c.type === "nope"), 1)[0]);
    }
    g.current = b.id;
    const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0 });
    runner.step();
    now += 1500;
    runner.step();
    now += E.RULES.nope + 1;
    s.tick();
    assert.equal(s.rooms[r.code].game.phase, "future");
    const restored = new RoomService({ allowBots: true, file, now: () => now });
    restored.touch(h.id, restored.rooms[r.code]);
    const resumed = new bots.BotRunner(restored, {
      now: () => now,
      rng: () => 0,
    });
    resumed.step();
    now += 1500;
    resumed.step();
    assert.equal(restored.rooms[r.code].game.phase, "action");
    resumed.step();
    now += 1500;
    resumed.step();
    assert.notEqual(restored.rooms[r.code].game.phase, "nope");
    E.assertInvariant(restored.rooms[r.code].game);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Bot 随快照恢复，重新开局自动准备，2–6 人最终可以结束对局", () => {
  assert.equal(typeof bots.BotRunner, "function");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boom-bots-"));
  try {
    const file = path.join(dir, "state.json");
    const s = new RoomService({ allowBots: true, file, now: () => 1000 });
    const h = s.session({ name: "人" }).player;
    let r = s.create(h.id);
    r = command(s, h.id, r, "addBots", { count: 1, respondNope: true });
    const restored = new RoomService({
      allowBots: true,
      file,
      now: () => 1001,
    });
    assert.equal(
      restored.view(h.id, r.code).players.filter((p) => p.isBot).length,
      1,
    );
    assert.equal(
      restored.rooms[r.code].players.find((p) => p.isBot).respondNope,
      true,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const { n, options } of [
    ...[2, 3, 4, 5, 6].map(n => ({ n, options: {} })),
    ...[{includeImploding:false,includeReverse:true},{includeImploding:true,includeReverse:false},{includeImploding:false,includeReverse:false}].map(options => ({n:6,options})),
  ]) {
    let now = 1000;
    let seed = n;
    const rng = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const s = new RoomService({ allowBots: true, now: () => now });
    const h = s.session({ name: "验证者" }).player;
    let r = s.create(h.id, options);
    r = command(s, h.id, r, "addBots", { count: n - 1, respondNope: true });
    r = command(s, h.id, r, "ready", { ready: true });
    r = command(s, h.id, r, "start");
    const runner = new bots.BotRunner(s, { now: () => now, rng });
    let botCommands = 0;
    const ordinaryCommand = s.command.bind(s);
    s.command = (id, code, action) => {
      const result = ordinaryCommand(id, code, action);
      if (s.rooms[code]?.players.some((p) => p.id === id && p.isBot))
        botCommands++;
      return result;
    };
    let steps = 0;
    while (s.rooms[r.code].status === "playing" && steps++ < 2500) {
      now += 1000;
      s.touch(h.id, s.rooms[r.code]);
      s.tick();
      runner.step();
      E.assertInvariant(s.rooms[r.code].game);
      const v = s.view(h.id, r.code);
      assert(!("deck" in v.game));
      assert(v.game.players.every((p) => !("hand" in p)));
    }
    assert.equal(
      s.rooms[r.code].status,
      "finished",
      `${n} players exceeded time`,
    );
    assert(s.rooms[r.code].game.winner);
    assert(botCommands >= n - 1, `${n} players must actually use BotRunner`);
    r = command(s, h.id, s.view(h.id, r.code), "rematch");
    assert(r.players.filter((p) => p.isBot).every((p) => p.ready));
  }
});

test("无计时六人 Bot 私密重排快照恢复，真人重连后继续且保留翻面内爆", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boom-alter-bot-"));
  try {
    let now = 1000;
    const file = path.join(dir, "state.json");
    const s = new RoomService({ allowBots: true, file, now: () => now });
    const h = s.session({ name: "人" }).player;
    let r = s.create(h.id, { noTurnTimer: true });
    r = command(s, h.id, r, "addBots", { count: 5, respondNope: false });
    r = command(s, h.id, r, "ready", { ready: true });
    r = command(s, h.id, r, "start");
    const b = r.players.find((p) => p.isBot);
    const g = s.rooms[r.code].game;
    const hand = g.players.find((p) => p.id === b.id).hand;
    const source = [g.deck, ...g.players.map((p) => p.hand)].find((cards) => cards.some((c) => c.type === "alterFuture"));
    hand.unshift(source.splice(source.findIndex((c) => c.type === "alterFuture"), 1)[0]);
    const imploding = g.deck.splice(g.deck.findIndex((c) => c.type === "imploding"), 1)[0];
    imploding.faceUp = true;
    g.deck.sort((a, b) => (a.type === "bomb") - (b.type === "bomb"));
    g.deck.splice(1, 0, imploding);
    g.current = b.id;
    const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0 });
    runner.step();
    now += 1500;
    runner.step();
    assert.equal(s.rooms[r.code].game.pending.type, "alterFuture");
    now += E.RULES.nope + 1;
    s.tick();
    assert.equal(s.rooms[r.code].game.phase, "alterFuture");
    assert.equal(s.view(b.id, r.code).game.future[1].id, imploding.id);
    assert(!("future" in s.view(h.id, r.code).game));
    command(s, h.id, s.view(h.id, r.code), "leave");
    const restored = new RoomService({ allowBots: true, file, now: () => now });
    const resumed = new bots.BotRunner(restored, { now: () => now, rng: () => 0 });
    const revision = restored.rooms[r.code].revision;
    resumed.step();
    now += 1500;
    resumed.step();
    assert.equal(restored.rooms[r.code].revision, revision, "无人在线时不处理私密重排");
    restored.touch(h.id, restored.rooms[r.code]);
    resumed.step();
    now += 1500;
    resumed.step();
    const result = restored.rooms[r.code].game;
    assert.equal(result.phase, "action");
    assert.equal(result.deadline, null);
    assert.equal(result.deck[2].id, imploding.id);
    assert.equal(result.deck[2].faceUp, true);
    resumed.step();
    now += 1500;
    resumed.step();
    assert.notEqual(restored.rooms[r.code].game.current, b.id, "已出牌的重排 Bot 继续安全抽牌");
    E.assertInvariant(restored.rooms[r.code].game);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Bot 首次抽到内爆后插回原牌，不消耗拆弹且保留翻面", () => {
  let now = 1000;
  const s = new RoomService({ allowBots: true, now: () => now });
  const h = s.session({ name: "人" }).player;
  let r = s.create(h.id, { noTurnTimer: true });
  r = command(s, h.id, r, "addBots", { count: 5, respondNope: false });
  r = command(s, h.id, r, "ready", { ready: true });
  r = command(s, h.id, r, "start");
  const b = r.players.find((p) => p.isBot);
  const g = s.rooms[r.code].game;
  const imploding = g.deck.splice(g.deck.findIndex((c) => c.type === "imploding"), 1)[0];
  g.deck.unshift(imploding);
  g.current = b.id;
  const defuses = g.players.find((p) => p.id === b.id).hand.filter((c) => c.type === "defuse").length;
  const runner = new bots.BotRunner(s, { now: () => now, rng: () => 0.99 });
  runner.step();
  now += 1500;
  runner.step();
  assert.equal(s.rooms[r.code].game.phase, "insert");
  assert.equal(s.view(b.id, r.code).game.bomb.type, "imploding");
  runner.step();
  now += 1500;
  runner.step();
  const result = s.rooms[r.code].game;
  assert.equal(result.deck.at(-1).id, imploding.id);
  assert.equal(result.deck.at(-1).faceUp, true);
  assert.equal(s.view(h.id, r.code).game.deckBottom.id, imploding.id);
  assert.equal(result.players.find((p) => p.id === b.id).hand.filter((c) => c.type === "defuse").length, defuses);
  E.assertInvariant(result);
});
