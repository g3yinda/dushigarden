"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const random = () => randomInt(0, 0x100000000) / 0x100000000;
const pick = (list, rng) =>
  list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

// Receives exactly the same private projection as a real client. Never reads a deck or another hand.
function chooseAction(
  room,
  { rng = random, played = 0, respondNope = false } = {},
) {
  const g = room.game,
    id = room.me;
  if (
    !g ||
    g.phase === "finished" ||
    !g.players.some((p) => p.id === id && p.alive)
  )
    return null;
  const hand = g.hand;
  if (g.phase === "nope") {
    const pending = g.pending;
    const nope = hand.find((c) => c.type === "nope");
    if (!pending || (pending.responses?.[id] && pending.responses[id] !== "waiting")) return null;
    const pass = { type: "passNope", nopeCount: pending.nopeCount };
    if (!respondNope || !nope) return pass;
    const actorBot = room.players.find((p) => p.id === pending.actor)?.isBot;
    const restoreOwn = pending.actor === id && pending.nopeCount % 2 === 1;
    const cancelHuman =
      pending.actor !== id && !actorBot && pending.nopeCount % 2 === 0;
    return restoreOwn || cancelHuman ? { type: "nope", cardId: nope.id, nopeCount: pending.nopeCount } : pass;
  }
  if (g.phase === "favor") {
    if (g.pending?.target !== id || !hand.length) return null;
    const rank = (c) =>
      c.type.startsWith("cat")
        ? 0
        : c.type === "nope"
          ? 1
          : c.type === "defuse"
            ? 3
            : 2;
    return {
      type: "give",
      cardId: [...hand].sort((a, b) => rank(a) - rank(b))[0].id,
    };
  }
  if (g.current !== id) return null;
  if (g.phase === "defuse")
    return hand.some((c) => c.type === "defuse") ? { type: "defuse" } : null;
  if (g.phase === "insert")
    return {
      type: "insert",
      position:
        1 + Math.min(g.deckCount, Math.floor(rng() * (g.deckCount + 1))),
    };
  if (g.phase === "future") return { type: "closeFuture" };
  if (g.phase !== "action") return null;
  if (played >= 1) return { type: "draw" };
  const targets = g.players.filter(
    (p) => p.id !== id && p.alive && p.count > 0,
  );
  const actions = hand
    .filter(
      (c) =>
        ["attack", "skip", "favor", "shuffle", "future"].includes(c.type) &&
        (c.type !== "favor" || targets.length),
    )
    .map((c) => ({
      type: "play",
      cards: [c.id],
      ...(c.type === "favor" ? { target: pick(targets, rng).id } : {}),
    }));
  for (const kind of new Set(
    hand.filter((c) => c.type.startsWith("cat")).map((c) => c.type),
  )) {
    const same = hand.filter((c) => c.type === kind);
    if (same.length >= 2 && targets.length) {
      const count = same.length >= 3 ? 3 : 2;
      actions.push({
        type: "play",
        cards: same.slice(0, count).map((c) => c.id),
        target: pick(targets, rng).id,
        ...(count === 3
          ? {
              named: hand.some((c) => c.type === "defuse")
                ? "attack"
                : "defuse",
            }
          : {}),
      });
    }
  }
  return actions.length && rng() < 0.75 ? pick(actions, rng) : { type: "draw" };
}

class BotRunner {
  constructor(service, { now = service.now, rng = random, delay = 1500 } = {}) {
    this.service = service;
    this.now = now;
    this.rng = rng;
    this.delay = delay;
    this.memory = new Map();
  }
  step() {
    const active = new Set();
    for (const original of Object.values(this.service.rooms)) {
      if (original.status !== "playing") continue;
      const present = original.players.some(
        (p) => !p.isBot && this.service.online(p),
      );
      for (const p of original.players.filter((p) => p.isBot))
        active.add(original.code + ":" + p.id);
      for (const seat of original.players.filter((p) => p.isBot)) {
        const key = original.code + ":" + seat.id;
        if (!present) {
          const paused = this.memory.get(key);
          if (paused) delete paused.context;
          continue;
        }
        const room = this.service.view(seat.id, original.code),
          g = room.game;
        if (!g || g.phase === "finished") continue;
        const turn = [g.id, g.turnNumber || 0, g.current, g.remaining].join(
          ":",
        );
        let memory = this.memory.get(key);
        if (!memory || memory.turn !== turn)
          memory = {
            turn,
            played: seat.botTurn?.turn === turn ? seat.botTurn.played : 0,
          };
        const context = g.phase === "nope"
          ? [g.id, g.phase, g.pending?.nopeCount, g.deadline].join(":")
          : [g.id, g.version, g.phase, g.current].join(":");
        if (memory.context !== context) {
          memory.context = context;
          memory.due = this.now() + this.delay;
        }
        this.memory.set(key, memory);
        if (this.now() < memory.due || (g.deadline && this.now() >= g.deadline))
          continue;
        const action = chooseAction(room, {
          rng: this.rng,
          played: memory.played,
          respondNope: seat.respondNope,
        });
        if (!action) continue;
        try {
          this.service.command(seat.id, room.code, {
            ...action,
            revision: room.revision,
            gameId: g.id,
            commandId: "bot-" + randomUUID(),
          });
          if (action.type === "play") memory.played++;
        } catch (error) {
          memory.due = this.now() + this.delay;
          if (error.code !== "STALE")
            console.error("Bot 指令失败", room.code, error.code || error.name);
        }
        // Let the updated state reach clients before another bot acts in this room.
        break;
      }
    }
    for (const key of this.memory.keys())
      if (!active.has(key)) this.memory.delete(key);
  }
}
module.exports = { chooseAction, BotRunner };
