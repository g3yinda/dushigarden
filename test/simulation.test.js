const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../server/engine");
const { TYPES } = require("../shared/cards");
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
for (const n of [2, 3, 4, 5])
  test(`${n} 人 × 25 局完整随机对局：守恒、私密投影、最终胜者`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = seeded(seed);
      let now = 1000;
      let g = E.createGame(
        Array.from({ length: n }, (_, i) => ({
          id: "p" + i,
          name: "猫" + i,
          avatar: i,
        })),
        { rng, now, id: "sim-" + n + "-" + seed },
      );
      let steps = 0;
      while (g.phase !== "finished" && steps++ < 1500) {
        now += 1;
        const p = g.players.find((p) => p.id === g.current);
        let actor = p.id;
        let a;
        if (g.phase === "nope") {
          const neg = g.players.find(
            (p) => p.alive && g.pending.responses[p.id] === "waiting" && p.hand.some((c) => c.type === "nope"),
          );
          if (neg && rng() < 0.15) {
            actor = neg.id;
            a = {
              type: "nope",
              cardId: neg.hand.find((c) => c.type === "nope").id,
            };
          } else {
            now = g.deadline;
            g = E.tick(g, { now, rng });
          }
        } else if (g.phase === "action") {
          const targets = g.players.filter((t) => t.alive && t.id !== p.id);
          const withCards = targets.filter((t) => t.hand.length);
          const kinds = [...new Set(p.hand.map((c) => c.type))];
          const combo = kinds.find(
            (type) => p.hand.filter((c) => c.type === type).length >= 2,
          );
          if (combo && withCards.length && rng() < 0.3) {
            const same = p.hand.filter((c) => c.type === combo);
            const count = same.length >= 3 && rng() < 0.5 ? 3 : 2;
            a = {
              type: "play",
              cards: same.slice(0, count).map((c) => c.id),
              target: withCards[0].id,
              named: TYPES[1 + Math.floor(rng() * (TYPES.length - 1))],
            };
          } else {
            const playable = p.hand.filter(
              (c) =>
                ["attack", "skip", "shuffle", "future", "favor"].includes(
                  c.type,
                ) &&
                (c.type !== "favor" || withCards.length),
            );
            if (playable.length && rng() < 0.65) {
              const c = playable[Math.floor(rng() * playable.length)];
              a = { type: "play", cards: [c.id], target: withCards[0]?.id };
            } else a = { type: "draw" };
          }
        } else if (g.phase === "defuse") a = { type: "defuse" };
        else if (g.phase === "insert")
          a = {
            type: "insert",
            position: 1 + Math.floor(rng() * (g.deck.length + 1)),
          };
        else if (g.phase === "future") a = { type: "closeFuture" };
        else if (g.phase === "favor") {
          actor = g.pending.target;
          const target = g.players.find((p) => p.id === actor);
          a = { type: "give", cardId: target.hand[0].id };
        }
        if (a) g = E.command(g, actor, a, { now, rng });
        E.assertInvariant(g);
        for (const recipient of g.players) {
          const view = E.project(g, recipient.id);
          assert(!("deck" in view));
          assert(view.players.every((p) => !("hand" in p)));
          if (g.phase !== "future" || recipient.id !== g.current)
            assert(!("future" in view));
        }
      }
      assert.equal(g.phase, "finished", `seed ${seed} exceeded budget`);
      assert.equal(g.players.filter((p) => p.alive).length, 1);
      assert(g.winner);
    }
  });
