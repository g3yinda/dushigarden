const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../server/engine");
const { TYPES, CARDS } = require("../shared/cards");
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
for (const n of [2, 3, 4, 5, 6])
  test(`${n} 人 × 25 局完整随机对局：守恒、私密投影、最终胜者`, () => {
    const exercised = new Set();
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
      assert.equal(g.rulesVersion, n === 6 ? "ek-imploding-2023-online-v1" : "ek-original-2025-online-v1");
      assert.equal(g.deck.length, { 2: 35, 3: 29, 4: 23, 5: 16, 6: 28 }[n]);
      const namedTypes = TYPES.filter((type) => !["bomb", "imploding"].includes(type) && (n === 6 || !CARDS[type].expansion));
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
          const groups = kinds.map((type) => p.hand.filter((c) => c.type === type));
          const feral = p.hand.filter((c) => c.type === "feral");
          for (const type of kinds.filter((type) => /^cat[1-5]$/.test(type)))
            if (feral.length) groups.push([...p.hand.filter((c) => c.type === type), ...feral]);
          const same = groups.find((cards) => cards.length >= (withCards.length ? 2 : 3));
          if (same && targets.length && rng() < 0.3) {
            const count = same.length >= 3 && rng() < 0.5 ? 3 : 2;
            if (count === 3 || withCards.length) a = {
              type: "play",
              cards: same.slice(0, count).map((c) => c.id),
              target: (count === 3 ? targets : withCards)[0].id,
              ...(count === 3 ? { named: namedTypes[Math.floor(rng() * namedTypes.length)] } : {}),
            };
          }
          if (!a) {
            const playable = p.hand.filter(
              (c) =>
                ["attack", "skip", "shuffle", "future", "favor", "targetAttack", "reverse", "bottom", "alterFuture"].includes(
                  c.type,
                ) &&
                (c.type !== "favor" || withCards.length),
            );
            if (playable.length && rng() < 0.65) {
              const c = playable[Math.floor(rng() * playable.length)];
              a = { type: "play", cards: [c.id], ...(c.type === "targetAttack"
                ? { target: g.players.filter((t) => t.alive)[Math.floor(rng() * g.players.filter((t) => t.alive).length)].id }
                : c.type === "favor" ? { target: withCards[0].id } : {}) };
            } else a = { type: "draw" };
          }
        } else if (g.phase === "defuse") a = { type: "defuse" };
        else if (g.phase === "insert")
          a = {
            type: "insert",
            position: 1 + Math.floor(rng() * (g.deck.length + 1)),
          };
        else if (g.phase === "future") a = { type: "closeFuture" };
        else if (g.phase === "alterFuture") {
          const visible = E.project(g, actor).future;
          a = { type: "orderFuture", order: [...visible].reverse().map((c) => c.id) };
        }
        else if (g.phase === "favor") {
          actor = g.pending.target;
          const target = g.players.find((p) => p.id === actor);
          a = { type: "give", cardId: target.hand[0].id };
        }
        if (a) {
          exercised.add(a.type);
          if (a.type === "play") {
            const selected = g.players.find((t) => t.id === actor).hand.filter((c) => a.cards.includes(c.id));
            for (const card of selected) exercised.add(card.type);
          }
          if (g.phase === "insert" && g.bomb?.type === "imploding") exercised.add("imploding");
          g = E.command(g, actor, a, { now, rng });
        }
        E.assertInvariant(g);
        for (const recipient of g.players) {
          const view = E.project(g, recipient.id);
          assert(!("deck" in view));
          assert(view.players.every((p) => !("hand" in p)));
          if (!["future", "alterFuture"].includes(g.phase) || recipient.id !== g.current)
            assert(!("future" in view));
          for (const boundary of ["deckTop", "deckBottom"])
            if (view[boundary]) {
              assert.equal(view[boundary].type, "imploding");
              assert.equal(view[boundary].faceUp, true);
            }
        }
      }
      assert.equal(g.phase, "finished", `seed ${seed} exceeded budget`);
      assert.equal(g.players.filter((p) => p.alive).length, 1);
      assert(g.winner);
    }
    if (n === 6) for (const type of ["targetAttack", "reverse", "bottom", "alterFuture", "feral", "imploding", "orderFuture"])
      assert(exercised.has(type), `六人随机对局必须实际执行 ${type}`);
  });
