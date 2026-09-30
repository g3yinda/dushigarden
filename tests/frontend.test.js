const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../miniprogram/lib/controller");
const room = {
  me: "a",
  hostId: "a",
  status: "playing",
  players: [
    { id: "a", name: "甲" },
    { id: "b", name: "乙" },
  ],
  game: {
    id: "g",
    phase: "action",
    current: "a",
    remaining: 1,
    players: [
      { id: "a", alive: true, count: 3 },
      { id: "b", alive: true, count: 3 },
    ],
    hand: [
      { id: "1", type: "cat1" },
      { id: "2", type: "cat1" },
      { id: "3", type: "defuse" },
    ],
    deckCount: 3,
  },
};
test("single cat cannot play; same-name pairs require target", () => {
  assert.equal(ui.selection(room, ["1"]).valid, false);
  assert.equal(ui.selection(room, ["1", "2"]).needsTarget, true);
  assert.equal(ui.selection(room, ["1", "3"]).valid, false);
});
test("out of turn cannot draw or play", () => {
  let r = structuredClone(room);
  r.game.current = "b";
  assert.equal(ui.derive(r, []).canDraw, false);
  assert.equal(ui.selection(r, ["1", "2"]).valid, false);
});
test("spectators cannot nope", () => {
  let r = structuredClone(room);
  r.game.phase = "nope";
  r.game.hand = [{ id: "n", type: "nope" }];
  r.game.players[0].alive = false;
  assert.equal(ui.derive(r, []).canNope, false);
});
test("selection drops stale card ids and insert exposes every position", () => {
  assert.equal(ui.selection(room, ["gone"]).valid, false);
  assert.deepEqual(
    ui
      .derive({ ...room, game: { ...room.game, phase: "insert" } }, [])
      .positions.map((x) => x.value),
    [1, 2, 3, 4],
  );
});
test("favor can only be given by its target", () => {
  let r = structuredClone(room);
  r.game.phase = "favor";
  r.game.pending = { target: "b" };
  assert.equal(ui.derive(r, ["1"]).canGive, false);
  r.game.pending.target = "a";
  assert.equal(ui.derive(r, ["1"]).canGive, true);
});
test("全部 13 种牌名必须与规则目录一致，并各自有明确素材", () => {
  const { CARDS } = require("../shared/cards");
  for (const [type, c] of Object.entries(CARDS)) {
    const front = ui.card({ id: "x", type });
    assert.equal(front.name, c.name);
    assert(front.source);
    assert(front.short);
  }
});
test("指向零手牌对手的索要/对子不能提交", () => {
  const r = structuredClone(room);
  r.game.players[1].count = 0;
  r.game.hand = [
    { id: "f", type: "favor" },
    { id: "1", type: "cat1" },
    { id: "2", type: "cat1" },
  ];
  assert.equal(ui.selection(r, ["f"]).valid, false);
  assert.equal(ui.selection(r, ["1", "2"]).valid, false);
});
test("陈旧选中牌不能交牌，插回索引恢复到合法值", () => {
  const r = structuredClone(room);
  r.game.phase = "favor";
  r.game.pending = { target: "a" };
  assert.equal(ui.derive(r, ["stale"]).canGive, false);
});
test("动效使用接收者可见状态，私密新牌只来自本人手牌", () => {
  const before = structuredClone(room);
  const after = structuredClone(room);
  after.game.hand.push({ id: "new", type: "skip" });
  after.game.players[0].count++;
  const effect = ui.motion(before, after);
  assert.equal(effect.kind, "draw");
  assert.equal(effect.card.type, "skip");
  const publicOnly = structuredClone(room);
  publicOnly.game.players[1].count++;
  assert.equal(ui.motion(before, publicOnly), null);
});
test("回合切换让出牌确认失效，否定层变化也必须重确认", () => {
  const after = structuredClone(room);
  after.game.current = "b";
  assert(ui.contextChanged(room, after));
  const a = structuredClone(room);
  a.game.phase = "nope";
  a.game.pending = { nopeCount: 0 };
  const b = structuredClone(a);
  b.game.pending.nopeCount = 1;
  assert(ui.contextChanged(a, b));
});
