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
function started() {
  const x = setup(),
    { s, a, b } = x;
  let r = s.create(a.player.id);
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
