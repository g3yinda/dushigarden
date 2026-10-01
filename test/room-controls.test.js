const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const E = require("../server/engine");
const { RoomService } = require("../server/rooms");
const { BotRunner } = require("../server/bots");
function setup(options = {}, bots = false) {
  let now = 1000;
  const s = new RoomService({ now: () => now, allowBots: true });
  const a = s.session({ name: "房主" }).player.id;
  const b = s.session({ name: "成员" }).player.id;
  let r = s.create(a, options);
  r = bots ? move(s, a, r, "addBots", { count: 1, respondNope: true }) : s.join(b, r.code);
  return { s, a, b, r, time: n => now = n };
}
function move(s, id, r, type, extra = {}) {
  return s.command(id, r.code, { type, revision: r.revision, gameId: r.game?.id, commandId: require("node:crypto").randomUUID(), ...extra });
}
function start(x) {
  for (const p of x.r.players) if (!p.isBot) x.r = move(x.s, p.id, x.r, "ready", { ready: true });
  x.r = move(x.s, x.a, x.r, "start");
  return x;
}
for (const nopeSeconds of [15, 10, 5]) {
  for (const noTurnTimer of [false, true]) test(`否定时长 ${nopeSeconds} 秒，不限时 ${noTurnTimer}，否定与反否定重新计时`, () => {
    let g = E.createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], { now: 1000, nopeSeconds, noTurnTimer });
    // Move existing cards rather than introducing extra cards; preserve invariants.
    const reserved = new Set();
    const hand = (id, type) => {
      const target = g.players.find(p => p.id === id);
      const source = [...g.players.map(p => p.hand), g.deck].find(h => h.some(c => c.type === type && !reserved.has(c.id)));
      const index = source.findIndex(c => c.type === type && !reserved.has(c.id));
      target.hand.push(source.splice(index, 1)[0]);
      const cardId = target.hand.at(-1).id;
      reserved.add(cardId);
      return cardId;
    };
    g.current = "a";
    const attack = hand("a", "attack"), n1 = hand("b", "nope"), n2 = hand("a", "nope");
    hand("b", "nope");
    g = E.command(g, "a", { type: "play", cards: [attack] }, { now: 2000 });
    assert.equal(g.deadline, 2000 + nopeSeconds * 1000);
    g = E.command(g, "b", { type: "nope", cardId: n1 }, { now: 3000 });
    assert.equal(g.deadline, 3000 + nopeSeconds * 1000);
    g = E.command(g, "a", { type: "nope", cardId: n2 }, { now: 4000 });
    assert.equal(g.deadline, 4000 + nopeSeconds * 1000);
    assert.equal(E.tick(g, { now: g.deadline - 1 }), g);
    g = E.tick(g, { now: g.deadline });
    assert.equal(g.current, "b");
    assert.equal(g.deadline === null, noTurnTimer);
    E.assertInvariant(g);
  });
}
test("新房间否定默认10秒，只接受数字15/10/5，开局与再开沿用", () => {
  const x = setup();
  assert.equal(x.r.options.nopeSeconds, 10);
  const outsider = x.s.session().player.id;
  for (const bad of [null, "10", 0, 1, 6, 20, {}, true])
    assert.throws(() => x.s.create(outsider, { nopeSeconds: bad }));
  for (const bad of [null, "10", 20])
    assert.throws(() => E.createGame([{ id: "a" }, { id: "b" }], { nopeSeconds: bad }));
  for (const seconds of [15, 10, 5]) {
    const y = start(setup({ nopeSeconds: seconds, noTurnTimer: true }));
    assert.equal(y.s.rooms[y.r.code].game.options.nopeSeconds, seconds);
    y.s.rooms[y.r.code].status = "finished";
    const next = move(y.s, y.a, y.r, "rematch");
    assert.equal(next.options.nopeSeconds, seconds);
  }
});
for (const playing of [false, true]) test(`房主关闭 ${playing ? "对局中" : "准备中"} 房间释放全员，幂等且拒绝加入/再开`, () => {
  const x = playing ? start(setup()) : setup();
  const { s, a, b, r } = x;
  const unchanged = JSON.stringify(s.rooms[r.code]);
  assert.throws(() => move(s, b, r, "closeRoom"), e => e.status === 403);
  assert.equal(JSON.stringify(s.rooms[r.code]), unchanged);
  assert.throws(() => move(s, a, { ...r, revision: r.revision - 1 }, "closeRoom"), e => e.code === "STALE");
  const command = { type: "closeRoom", commandId: "close-once", revision: r.revision };
  const closed = s.command(a, r.code, command);
  assert.equal(closed.status, "closed");
  assert.equal(closed.game, null);
  assert.equal(closed.closeReason, "host");
  assert.deepEqual(closed.players, []);
  assert.equal(s.current(a), null);
  assert.equal(s.current(b), null);
  assert.equal(s.view(b, r.code).status, "closed");
  assert.equal(s.command(a, r.code, command).revision, closed.revision);
  assert.throws(() => s.join(b, r.code), e => e.code === "ROOM_CLOSED");
  assert.throws(() => move(s, a, closed, "rematch"), e => e.code === "ROOM_CLOSED");
  const nextA = s.create(a), nextB = s.create(b);
  assert.notEqual(nextA.code, nextB.code);
  x.time(301001); s.tick();
  assert.equal(s.rooms[r.code], undefined);
  assert.equal(s.current(a).code, nextA.code);
});
test("关闭通知仅对原成员可见，保存恢复仍释放占用并停止Bot", () => {
  const x = start(setup({ nopeSeconds: 15 }, true));
  const { s, a } = x;
  const runner = new BotRunner(s, { delay: 10000 });
  runner.step();
  assert(runner.memory.size > 0);
  const closed = move(s, a, s.current(a), "closeRoom");
  runner.step();
  assert.equal(runner.memory.size, 0);
  assert.throws(() => s.view(x.b, closed.code), e => e.status === 403);
  const dir = fs.mkdtempSync(join(tmpdir(), "boomcat-close-"));
  try {
    s.file = join(dir, "state.json"); s.save();
    const recovered = new RoomService({ file: s.file, now: () => 1000 });
    assert.equal(recovered.current(a), null);
    assert.equal(recovered.view(a, closed.code).status, "closed");
    assert.equal(recovered.rooms[closed.code].game, null);
    assert.equal(recovered.view(a, closed.code).options.nopeSeconds, 15);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("旧快照缺少否定时长保留5秒，有配置的快照保留设置和deadline", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "boomcat-nope-"));
  try {
    const x = start(setup({ nopeSeconds: 15 }));
    x.s.file = join(dir, "state.json"); x.s.save();
    let recovered = new RoomService({ file: x.s.file, now: () => 1000 });
    assert.equal(recovered.current(x.a).options.nopeSeconds, 15);
    const snapshot = JSON.parse(fs.readFileSync(x.s.file));
    delete snapshot.rooms[x.r.code].options.nopeSeconds;
    delete snapshot.rooms[x.r.code].game.options.nopeSeconds;
    fs.writeFileSync(x.s.file, JSON.stringify(snapshot));
    recovered = new RoomService({ file: x.s.file, now: () => 1000 });
    assert.equal(recovered.current(x.a).options.nopeSeconds, 5);
    assert.equal(recovered.rooms[x.r.code].game.options.nopeSeconds, 5);
    assert.equal(recovered.current(x.a).game.deadline, x.r.game.deadline);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
