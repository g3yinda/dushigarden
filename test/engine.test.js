const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../server/engine");
const players = Array.from({ length: 5 }, (_, i) => ({
  id: "p" + i,
  name: "猫" + i,
  avatar: i,
}));
const opts = { now: 1000, rng: () => 0.4, id: "g" };
function game(n = 3) {
  return E.createGame(players.slice(0, n), opts);
}
function arrange(g, hands, deck = ["skip", "bomb", "bomb"]) {
  let id = 0;
  const card = (type) => ({ id: "c" + id++, type });
  g.players.forEach((p, i) => (p.hand = (hands[i] || []).map(card)));
  g.deck = deck.map(card);
  g.discard = [];
  g.current = "p0";
  g.remaining = 1;
  g.attacked = false;
  return g;
}
function act(g, p, type, extra = {}) {
  return E.command(g, p, { type, ...extra }, opts);
}
function settle(g) {
  return E.tick(g, { ...opts, now: g.deadline });
}
for (const n of [2, 3, 4, 5])
  test(`${n} 人开局和守恒`, () => {
    const g = game(n);
    assert.equal(g.deck.length, { 2: 35, 3: 29, 4: 23, 5: 16 }[n]);
    for (const p of g.players) {
      assert.equal(p.hand.length, 8);
      assert(p.hand.some((c) => c.type === "defuse"));
      assert(!p.hand.some((c) => c.type === "bomb"));
    }
    assert.equal(g.deck.filter((c) => c.type === "bomb").length, n - 1);
    E.assertInvariant(g);
  });
test("攻击转移剩余负债并加二，跳过只减一", () => {
  let g = arrange(game(), [["attack"], ["skip", "attack"], ["skip"]]);
  g = settle(act(g, "p0", "play", { cards: ["c0"] }));
  assert.equal(g.current, "p1");
  assert.equal(g.remaining, 2);
  g = settle(act(g, "p1", "play", { cards: ["c1"] }));
  assert.equal(g.remaining, 1);
  assert.equal(g.attacked, true);
  g = settle(act(g, "p1", "play", { cards: ["c2"] }));
  assert.equal(g.remaining, 3);
  assert.equal(g.current, "p2");
});
test("否定链奇数取消偶数恢复且牌不退回", () => {
  let g = arrange(game(), [["attack", "nope"], ["nope"], []]);
  g = act(g, "p0", "play", { cards: ["c0"] });
  g = act(g, "p1", "nope", { cardId: "c2" });
  assert.equal(g.pending.nopeCount, 1);
  const canceled = settle(g);
  assert.equal(canceled.current, "p0");
  assert.equal(canceled.discard.length, 2);
  g = act(g, "p0", "nope", { cardId: "c1" });
  g = settle(g);
  assert.equal(g.current, "p1");
  assert.equal(g.remaining, 2);
  assert.equal(g.discard.length, 3);
});
test("拆弹只能在炸弹阶段，位置保密且余债继续", () => {
  let g = arrange(game(), [["defuse"], [], []], ["bomb", "skip", "bomb"]);
  assert.throws(() => act(g, "p0", "defuse"));
  g.remaining = 2;
  g.attacked = true;
  g = act(g, "p0", "draw");
  assert.equal(g.phase, "defuse");
  assert.throws(() => act(g, "p0", "nope", { cardId: "c0" }));
  g = act(g, "p0", "defuse");
  assert.equal(g.phase, "insert");
  g = act(g, "p0", "insert", { position: 2 });
  assert.equal(g.deck[1].type, "bomb");
  assert.equal(g.remaining, 1);
  assert.equal(g.current, "p0");
  assert(!JSON.stringify(E.project(g, "p1")).includes("position"));
});
test("预知只给本人，不能改序，看完仍须行动", () => {
  let g = arrange(game(), [["future"], [], []]);
  g = settle(act(g, "p0", "play", { cards: ["c0"] }));
  assert.equal(E.project(g, "p0").future.length, 3);
  assert(!("future" in E.project(g, "p1")));
  const ids = g.deck.map((c) => c.id);
  g = act(g, "p0", "closeFuture");
  assert.deepEqual(
    g.deck.map((c) => c.id),
    ids,
  );
  assert.equal(g.current, "p0");
  assert.equal(g.phase, "action");
});
test("索要由目标选牌，转牌不向第三人泄露", () => {
  let g = arrange(game(), [["favor"], ["skip", "defuse"], []]);
  g = settle(act(g, "p0", "play", { cards: ["c0"], target: "p1" }));
  assert.equal(g.phase, "favor");
  assert.throws(() => act(g, "p0", "give", { cardId: "c2" }));
  g = act(g, "p1", "give", { cardId: "c2" });
  assert.equal(g.players[0].hand[0].type, "defuse");
  const view = E.project(g, "p2");
  assert.equal(view.hand.length, 0);
  assert(!JSON.stringify(view.privateLog).includes("拆弹"));
  assert.equal(view.players[0].count, 1);
});
test("任意同名对子忽略原效果，三张失败照样消耗", () => {
  let g = arrange(game(), [["attack", "attack"], ["defuse"], []]);
  g = settle(act(g, "p0", "play", { cards: ["c0", "c1"], target: "p1" }));
  assert.equal(g.current, "p0");
  assert.equal(g.players[0].hand[0].type, "defuse");
  g = arrange(game(), [["nope", "nope", "nope"], ["skip"], []]);
  g = settle(
    act(g, "p0", "play", {
      cards: ["c0", "c1", "c2"],
      target: "p1",
      named: "defuse",
    }),
  );
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.players[1].hand.length, 1);
  assert.equal(g.discard.length, 3);
});
test("非法命令不修改原状态", () => {
  let g = arrange(game(), [["cat1", "cat2"], [], []]);
  const before = JSON.stringify(g);
  assert.throws(() => act(g, "p0", "play", { cards: ["c0"] }));
  assert.throws(() =>
    act(g, "p0", "play", { cards: ["c0", "c0"], target: "p1" }),
  );
  assert.throws(() => act(g, "p1", "draw"));
  assert.equal(JSON.stringify(g), before);
});
test("出局封存手牌，最后存活者获胜", () => {
  let g = arrange(game(2), [["skip"], ["defuse"]], ["bomb"]);
  g = act(g, "p0", "draw");
  assert.equal(g.phase, "finished");
  assert.equal(g.winner, "p1");
  assert.equal(g.players[0].hand.length, 1);
  assert.equal(E.project(g, "p1").players[0].alive, false);
  assert.equal(E.project(g, "p1").hand.length, 1);
  assert.equal(g.discard.length, 0);
});
test("行动预算经过非结束回合牌不会重置", () => {
  let g = arrange(game(), [["shuffle"], [], []]);
  g = E.command(
    g,
    "p0",
    { type: "play", cards: ["c0"] },
    { ...opts, now: 11000 },
  );
  g = E.tick(g, { ...opts, now: 16000 });
  assert.equal(g.deadline, 36000);
  assert.equal(g.phase, "action");
});
test("超时自动抽牌、拆弹和插回且只执行一次", () => {
  let g = arrange(game(), [["defuse"], [], []], ["bomb", "skip", "bomb"]);
  g = settle(g);
  assert.equal(g.phase, "defuse");
  g = settle(g);
  assert.equal(g.phase, "insert");
  g = settle(g);
  assert.equal(g.phase, "action");
  assert.equal(g.current, "p1");
  assert.equal(g.discard.length, 1);
  const v = g.version;
  g = E.tick(g, { ...opts, now: 0 });
  assert.equal(g.version, v);
});
