const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { RoomService } = require("../server/rooms");
function setup() {
  let now = 1000;
  const s = new RoomService({ now: () => now });
  const a = s.session({ name: "小白", avatar: 0 });
  const b = s.session({ name: "阿橙", avatar: 1 });
  return { s, a, b, time: (n) => (now = n) };
}
function cmd(s, p, r, type, more = {}) {
  return s.command(p, r.code, {
    commandId: Math.random().toString(36),
    revision: r.revision,
    gameId: r.game?.id,
    type,
    ...more,
  });
}
function started(options = {}) {
  const x = setup(),
    { s, a, b } = x;
  let r = s.create(a.player.id, options);
  r = s.join(b.player.id, r.code);
  r = cmd(s, a.player.id, r, "ready", { ready: true });
  r = cmd(s, b.player.id, r, "ready", { ready: true });
  r = cmd(s, a.player.id, r, "start");
  return { ...x, r };
}
test("准备、开始条件与人数变更取消准备", () => {
  const { s, a, b } = setup();
  let r = s.create(a.player.id);
  assert.throws(() => cmd(s, a.player.id, r, "start"));
  r = cmd(s, a.player.id, r, "ready", { ready: true });
  r = s.join(b.player.id, r.code);
  assert(r.players.every((p) => !p.ready));
  assert.throws(() => cmd(s, b.player.id, r, "start"));
  assert.throws(() => cmd(s, a.player.id, r, "start"));
});
test("一人只占一席、不同房间限制", () => {
  const { s, a, b } = setup();
  let r = s.create(a.player.id);
  s.join(a.player.id, r.code);
  assert.equal(s.view(a.player.id, r.code).players.length, 1);
  const r2 = s.create(b.player.id);
  assert.throws(() => s.join(a.player.id, r2.code));
});
test("陈旧命令拒绝，重发同一命令不会重复抽牌", () => {
  const { s, r } = started();
  const p = r.game.current;
  const before = s.view(p, r.code);
  const a = {
    commandId: "draw-once",
    revision: r.revision,
    gameId: r.game.id,
    type: "draw",
  };
  const first = s.command(p, r.code, a);
  const second = s.command(p, r.code, a);
  assert.equal(first.revision, second.revision);
  assert.equal(first.game.deckCount, second.game.deckCount);
  assert.throws(
    () => s.command(p, r.code, { ...a, commandId: "different" }),
    (e) => e.code === "STALE",
  );
  assert.throws(() => s.command(p, r.code, { ...a, type: "defuse" }));
  assert(before.game.hand.length === 8);
});
test("非成员无法看房间；投影无牌库、其他人手牌", () => {
  const { s, r, a, b } = started();
  const c = s.session({ name: "访客" });
  assert.throws(() => s.view(c.player.id, r.code));
  const view = s.view(a.player.id, r.code);
  assert.equal(view.game.hand.length, 8);
  assert(!("deck" in view.game));
  assert(view.game.players.every((p) => !("hand" in p)));
  assert.equal(s.authenticate(a.token).id, a.player.id);
  assert.throws(() => s.authenticate("fake"));
});
test("退出对局保留托管席位，不能另开房，回来恢复", () => {
  const { s, r, a } = started();
  cmd(s, a.player.id, r, "leave");
  assert.throws(() => s.create(a.player.id));
  assert.equal(s.current(a.player.id).code, r.code);
  assert.equal(s.view(a.player.id, r.code).players.length, 2);
});
test("全部断线五分钟中止，没有胜者", () => {
  const { s, r, time } = started();
  time(40000);
  s.tick();
  time(341000);
  s.tick();
  const room = s.rooms[r.code];
  assert.equal(room.status, "aborted");
  assert.equal(room.game.winner, null);
});
test("持久化恢复会话和牌库，令牌以摘要存储", () => {
  const dir = mkdtempSync(join(tmpdir(), "boomcat-test-"));
  try {
    const file = join(dir, "state.json");
    let s = new RoomService({ file });
    const a = s.session({ name: "小白" });
    const r = s.create(a.player.id);
    s = new RoomService({ file });
    assert.equal(s.authenticate(a.token).id, a.player.id);
    assert.equal(s.current(a.player.id).code, r.code);
    assert(!require("node:fs").readFileSync(file, "utf8").includes(a.token));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("损坏单局快照只中止该局，不阻止其他房间恢复", () => {
  const fs = require("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "boomcat-corrupt-"));
  try {
    const file = join(dir, "state.json");
    const { s, r, a } = started();
    const c = s.session({ name: "另一房" });
    const other = s.create(c.player.id);
    s.file = file;
    s.save();
    const snapshot = JSON.parse(fs.readFileSync(file));
    snapshot.rooms[r.code].game.deck.pop();
    fs.writeFileSync(file, JSON.stringify(snapshot));
    const restored = new RoomService({ file });
    assert.equal(restored.current(a.player.id).status, "aborted");
    assert(restored.rooms[r.code].diagnosticId);
    assert.equal(restored.current(c.player.id).status, "waiting");
    assert.equal(restored.current(c.player.id).code, other.code);
    assert.equal(
      JSON.parse(fs.readFileSync(file)).rooms[r.code].status,
      "aborted",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("编辑昵称头像后建房使用最新资料", () => {
  const { s, a } = setup();
  s.profile(a.player.id, { name: "新的小猫", avatar: 2 });
  const r = s.create(a.player.id);
  assert.equal(r.players[0].name, "新的小猫");
  assert.equal(r.players[0].avatar, 2);
});
test("房间选项默认 false，只接受布尔值且不接受自定义时长", () => {
  const { s, a } = setup();
  for (const noTurnTimer of [null, 1, "true", {}, []])
    assert.throws(() => s.create(a.player.id, { noTurnTimer }));
  const r = s.create(a.player.id, { action: 1, nope: 1 });
  assert.deepEqual(r.options, { noTurnTimer: false, nopeSeconds: 10, allowNopeChain: true, includeImploding: true, includeReverse: true });
});
test("不限时选项保存快照，重开沿用，旧快照缺项默认 false", () => {
  const fs = require("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "boomcat-options-"));
  try {
    const { s, a, r } = started({ noTurnTimer: true });
    assert.deepEqual(r.options, { noTurnTimer: true, nopeSeconds: 10, allowNopeChain: true, includeImploding: true, includeReverse: true });
    assert.equal(r.game.deadline, null);
    s.file = join(dir, "state.json");
    s.save();
    const restored = new RoomService({ file: s.file, now: () => 1000 });
    assert.deepEqual(restored.current(a.player.id).options, r.options);
    assert.equal(restored.rooms[r.code].game.options.noTurnTimer, true);
    restored.rooms[r.code].status = "aborted";
    let next = cmd(restored, a.player.id, restored.current(a.player.id), "rematch");
    assert.deepEqual(next.options, r.options);
    for (const p of next.players) next = cmd(restored, p.id, next, "ready", { ready: true });
    next = cmd(restored, a.player.id, next, "start");
    assert.equal(next.game.deadline, null);
    const data = JSON.parse(fs.readFileSync(s.file));
    delete data.rooms[r.code].options;
    delete data.rooms[r.code].game.options;
    data.rooms[r.code].game.deadline = 31000;
    fs.writeFileSync(s.file, JSON.stringify(data));
    const legacy = new RoomService({ file: s.file, now: () => 1000 });
    assert.deepEqual(legacy.current(a.player.id).options, { noTurnTimer: false, nopeSeconds: 5, allowNopeChain: true, includeImploding: true, includeReverse: true });
    assert.equal(legacy.current(a.player.id).game.deadline, 31000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
const E = require("../server/engine");
function phaseRoom(name) {
  const x = started({ noTurnTimer: true });
  const room = x.s.rooms[x.r.code], g = room.game;
  g.current = x.a.player.id;
  g.phase = name;
  g.deadline = null;
  if (name === "favor") g.pending = { actor: x.a.player.id, target: x.b.player.id, type: "favor", nopeCount: 0 };
  if (name === "future") g.future = g.deck.slice(0, 3);
  if (["defuse", "insert"].includes(name)) g.bomb = g.deck.splice(g.deck.findIndex((c) => c.type === "bomb"), 1)[0];
  if (name === "action") {
    const safe = g.deck.findIndex((c) => c.type !== "bomb");
    [g.deck[0], g.deck[safe]] = [g.deck[safe], g.deck[0]];
  }
  E.assertInvariant(g);
  return { ...x, room, responsible: name === "favor" ? x.b.player.id : x.a.player.id };
}
for (const name of ["action", "favor", "future", "defuse", "insert"])
  test(`不限时 ${name} 在线等待，离线托管等待原阶段时长，回来取消`, () => {
    const { s, time, r, responsible } = phaseRoom(name);
    time(100000);
    for (const p of s.rooms[r.code].players) s.touch(p.id, s.rooms[r.code]);
    const before = s.rooms[r.code].game.version;
    s.tick();
    assert.equal(s.rooms[r.code].game.version, before);
    cmd(s, responsible, s.view(responsible, r.code), "leave");
    s.tick();
    time(100000 + E.RULES[name] - 1);
    for (const p of s.rooms[r.code].players) if (p.id !== responsible) s.touch(p.id, s.rooms[r.code]);
    s.tick();
    assert.equal(s.rooms[r.code].game.version, before);
    s.touch(responsible, s.rooms[r.code]);
    time(100000 + E.RULES[name]);
    s.tick();
    assert.equal(s.rooms[r.code].game.version, before);
    cmd(s, responsible, s.view(responsible, r.code), "leave");
    s.tick();
    const deadline = 100000 + 2 * E.RULES[name];
    time(deadline - 1);
    for (const p of s.rooms[r.code].players) if (p.id !== responsible) s.touch(p.id, s.rooms[r.code]);
    s.tick();
    assert.equal(s.rooms[r.code].game.version, before);
    time(deadline);
    s.tick();
    assert.equal(s.rooms[r.code].game.version, before + 1);
    assert.equal(s.rooms[r.code].game.deadline, null);
    E.assertInvariant(s.rooms[r.code].game);
  });
test("网络断线在离线判定后等待正常时长，不限时仍在全员离线五分钟中止", () => {
  const { s, time, r } = phaseRoom("action");
  time(26000);
  s.tick();
  assert.equal(s.rooms[r.code].game.version, 1);
  time(55999); s.tick();
  assert.equal(s.rooms[r.code].game.version, 1);
  time(56000); s.tick();
  assert.equal(s.rooms[r.code].game.version, 2);
  time(326000); s.tick();
  assert.equal(s.rooms[r.code].status, "aborted");
  assert.equal(s.rooms[r.code].game.winner, null);
});
test("不限时 Bot 在线并继续行动，不替真人阻止全员离线中止", () => {
  const { s, a, time } = setup();
  s.allowBots = true;
  let r = s.create(a.player.id, { noTurnTimer: true });
  r = cmd(s, a.player.id, r, "addBots", { count: 1, respondNope: false });
  r = cmd(s, a.player.id, r, "ready", { ready: true });
  r = cmd(s, a.player.id, r, "start");
  const room = s.rooms[r.code];
  const bot = room.players.find((p) => p.isBot);
  room.game.current = bot.id;
  const runner = new (require("../server/bots").BotRunner)(s, { delay: 0, rng: () => 0.99 });
  const version = room.game.version;
  assert.equal(room.game.deadline, null);
  runner.step();
  assert.equal(s.rooms[r.code].game.version, version + 1);
  assert.equal(s.view(a.player.id, r.code).players.find((p) => p.isBot).online, true);
  time(26000); s.tick();
  time(326000); s.tick();
  assert.equal(s.rooms[r.code].status, "aborted");
});
test("索要阶段仅目标离线才托管，行动发起人离线仍等待在线目标", () => {
  const { s, time, a, b, r } = phaseRoom("favor");
  cmd(s, a.player.id, s.view(a.player.id, r.code), "leave");
  s.tick();
  time(100000);
  s.touch(b.player.id, s.rooms[r.code]);
  s.tick();
  assert.equal(s.rooms[r.code].game.phase, "favor");
  assert.equal(s.rooms[r.code].game.version, 1);
  assert.equal(s.rooms[r.code].game.deadline, null);
});
test("离线托管快照恢复保留截止时间和公开无限等待状态", () => {
  const dir = mkdtempSync(join(tmpdir(), "boomcat-offline-"));
  try {
    const { s, a, b, r } = phaseRoom("action");
    s.file = join(dir, "state.json");
    cmd(s, a.player.id, s.view(a.player.id, r.code), "leave");
    let now = 15000;
    const restored = new RoomService({ file: s.file, now: () => now });
    restored.tick();
    assert.equal(restored.rooms[r.code].game.version, 1);
    assert.equal(restored.current(a.player.id).game.deadline, null);
    now = 31000;
    restored.touch(b.player.id, restored.rooms[r.code]);
    restored.tick();
    assert.equal(restored.rooms[r.code].game.version, 2);
    assert.equal(restored.current(a.player.id).game.deadline, null);
    E.assertInvariant(restored.rooms[r.code].game);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const name of ["action", "favor", "future", "defuse", "insert"])
  test(`Bot 正常完成不限时 ${name} 选择`, () => {
    const { s, r, responsible } = phaseRoom(name);
    const room = s.rooms[r.code];
    room.players.find((p) => p.id === responsible).isBot = true;
    room.game.players.find((p) => p.id === responsible).isBot = true;
    const runner = new (require("../server/bots").BotRunner)(s, {
      delay: 0, rng: () => 0.99,
    });
    s.tick();
    assert.equal(s.rooms[r.code].game.deadline, null);
    assert.equal(s.rooms[r.code].game.version, 1);
    runner.step();
    assert.equal(s.rooms[r.code].game.version, 2);
    E.assertInvariant(s.rooms[r.code].game);
  });
