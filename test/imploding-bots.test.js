const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseAction } = require("../server/bots");

function view(types = [], phase = "action") {
  return {
    me: "b",
    players: [{ id: "a", isBot: false }, { id: "b", isBot: true }],
    game: {
      id: "g", phase, current: "b", remaining: 1,
      rulesVersion: "ek-imploding-2023-online-v1", direction: 1,
      players: [{ id: "a", alive: true, count: 0 }, { id: "b", alive: true, count: types.length }],
      hand: types.map((type, i) => ({ id: "card" + i, type })),
      deckCount: 10, deckTop: null, deckBottom: null,
    },
  };
}

for (const type of ["targetAttack", "reverse", "bottom", "alterFuture"])
  test(`Bot 可以使用扩展行动牌 ${type}`, () => {
    const room = view([type]);
    const action = chooseAction(room, { rng: () => 0 });
    assert.equal(action.type, "play");
    assert.deepEqual(action.cards, ["card0"]);
    if (type === "targetAttack") assert.equal(action.target, "a", "空手存活玩家也是攻击目标");
  });

test("Bot 定向攻击目标可以选择自己", () => {
  const room = view(["targetAttack"]);
  const values = [0.99, 0, 0];
  assert.equal(chooseAction(room, { rng: () => values.shift() ?? 0 }).target, "b");
});

test("Bot 私密重排将可见危险牌放到安全牌之后，保持完整排列", () => {
  const room = view([], "alterFuture");
  room.game.future = [
    { id: "i", type: "imploding", faceUp: true },
    { id: "s", type: "skip" },
    { id: "bomb", type: "bomb" },
  ];
  assert.deepEqual(chooseAction(room), { type: "orderFuture", order: ["s", "i", "bomb"] });
  assert.deepEqual(room.game.future.map((c) => c.id), ["i", "s", "bomb"], "决策不修改投影");
});

test("Bot 少于三张的重排仍只提交收到的牌，非操作者不重排", () => {
  const room = view([], "alterFuture");
  room.game.future = [{ id: "i", type: "imploding" }, { id: "f", type: "favor" }];
  assert.deepEqual(chooseAction(room), { type: "orderFuture", order: ["f", "i"] });
  room.game.current = "a";
  delete room.game.future;
  assert.equal(chooseAction(room), null);
});

for (const types of [["cat1", "feral"], ["feral", "feral"], ["cat2", "feral", "feral"], ["feral", "feral", "feral"]])
  test(`Bot 可以使用野猫组合 ${types.join("+")}`, () => {
    const room = view(types);
    if (types.length === 2) room.game.players[0].count = 2;
    const action = chooseAction(room, { rng: () => 0 });
    assert.equal(action.type, "play");
    assert.equal(action.cards.length, types.length);
    assert.equal(action.target, "a");
    if (types.length === 3) assert.equal(action.named, "defuse");
  });

for (const type of ["defuse", "nope", "skip", "cat6"])
  test(`Bot 不把野猫当作 ${type} 的替身`, () => {
    const room = view([type, "feral"]);
    room.game.players[0].count = 3;
    const action = chooseAction(room, { rng: () => 0 });
    assert(action.type !== "play" || action.cards.length === 1);
  });

for (const type of ["skip", "attack", "targetAttack", "reverse", "bottom"])
  test(`公开翻面内爆在牌顶时，即使本轮已出牌也使用 ${type}`, () => {
    const room = view([type]);
    room.game.deckTop = { id: "i", type: "imploding", faceUp: true };
    const action = chooseAction(room, { played: 1, rng: () => 0.99 });
    assert.equal(action.type, "play");
    assert.deepEqual(action.cards, ["card0"]);
  });

test("Bot 不以摸牌底避开牌顶内爆时再摸到已公开危险牌底", () => {
  const room = view(["bottom", "skip"]);
  room.game.deckTop = room.game.deckBottom = { id: "i", type: "imploding", faceUp: true };
  assert.deepEqual(chooseAction(room, { played: 1, rng: () => 0 }), { type: "play", cards: ["card1"] });
  room.game.hand = room.game.hand.slice(0, 1);
  assert.deepEqual(chooseAction(room, { played: 1, rng: () => 0 }), { type: "draw" });
});

test("仅牌底公开内爆时 Bot 不主动摸牌底，隐藏牌堆从不读取", () => {
  const room = view(["bottom"]);
  room.game.deckBottom = { id: "i", type: "imploding", faceUp: true };
  Object.defineProperty(room.game, "deck", { get() { throw new Error("隐藏牌库不可读"); } });
  Object.defineProperty(room.game.players[0], "hand", { get() { throw new Error("对手手牌不可读"); } });
  assert.deepEqual(chooseAction(room, { rng: () => 0 }), { type: "draw" });
});

test("扩展动作被否定时 Bot 的本层不出锁定保持有效", () => {
  const room = view(["nope"], "nope");
  room.game.pending = { actor: "a", type: "alterFuture", nopeCount: 0, responses: { b: "passed" } };
  assert.equal(chooseAction(room, { respondNope: true }), null);
});
