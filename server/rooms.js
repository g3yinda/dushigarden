"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const E = require("./engine");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
class ServiceError extends Error {
  constructor(message, code = "INVALID_ACTION", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (message, code, status) => {
  throw new ServiceError(message, code, status);
};
const copy = (x) => JSON.parse(JSON.stringify(x));
class RoomService extends EventEmitter {
  constructor({ file = null, now = Date.now, allowBots = false } = {}) {
    super();
    this.setMaxListeners(200);
    this.file = file;
    this.now = now;
    this.allowBots = allowBots;
    this.players = {};
    this.sessions = {};
    this.rooms = {};
    this.presence = {};
    if (file && fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data.schema !== 1) throw new Error("不支持的快照版本");
      Object.assign(this, {
        players: data.players,
        sessions: data.sessions,
        rooms: data.rooms,
      });
      let repaired = false;
      for (const r of Object.values(this.rooms))
        if (r.game && r.status === "playing") {
          try {
            E.assertInvariant(r.game);
          } catch {
            this.abort(r);
            r.revision++;
            repaired = true;
          }
        }
      if (repaired) this.save();
    }
  }
  abort(r) {
    r.status = "aborted";
    r.diagnosticId = require("node:crypto").randomUUID();
    r.game.phase = "finished";
    r.game.winner = null;
    r.game.deadline = null;
    r.game.pending = null;
    r.game.future = null;
    r.game.logs.push({
      id: ++r.game.eventId,
      text: "对局异常中止，诊断编号 " + r.diagnosticId,
    });
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + ".tmp";
    fs.writeFileSync(
      temp,
      JSON.stringify({
        schema: 1,
        players: this.players,
        sessions: this.sessions,
        rooms: this.rooms,
      }),
      { mode: 0o600 },
    );
    fs.renameSync(temp, this.file);
  }
  session({ name = "小猫", avatar = 0 } = {}, identity = null) {
    const now = this.now();
    const key = identity ? "wx:" + hash(identity) : null;
    let p = key
      ? Object.values(this.players).find((p) => p.identity === key)
      : null;
    if (!p) {
      p = {
        id: crypto.randomUUID(),
        name: String(name).trim().slice(0, 12) || "小猫",
        avatar:
          Number.isInteger(avatar) && avatar >= 0 && avatar < 5 ? avatar : 0,
        identity: key,
      };
      this.players[p.id] = p;
    } else {
      p.name = String(name).trim().slice(0, 12) || p.name;
      p.avatar =
        Number.isInteger(avatar) && avatar >= 0 && avatar < 5
          ? avatar
          : p.avatar;
    }
    for (const [key, s] of Object.entries(this.sessions))
      if (s.expires <= now) delete this.sessions[key];
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions[hash(token)] = {
      playerId: p.id,
      expires: now + 7 * 86400000,
    };
    this.save();
    return {
      token,
      player: { id: p.id, name: p.name, avatar: p.avatar },
      mode: identity ? "wechat" : "local",
    };
  }
  profile(id, { name, avatar }) {
    const p = this.players[id];
    if (!p) fail("请重新登录", "UNAUTHORIZED", 401);
    const r = this.find(id);
    if (r?.status === "playing") fail("请结束当前对局后再修改资料");
    p.name =
      String(name || "")
        .trim()
        .slice(0, 12) || p.name;
    p.avatar =
      Number.isInteger(avatar) && avatar >= 0 && avatar < 4 ? avatar : p.avatar;
    if (r) {
      const seat = r.players.find((p) => p.id === id);
      seat.name = p.name;
      seat.avatar = p.avatar;
      this.changed(r);
    } else this.save();
    return { id: p.id, name: p.name, avatar: p.avatar };
  }
  authenticate(token) {
    const s = typeof token === "string" && this.sessions[hash(token)];
    if (!s || s.expires <= this.now()) fail("请重新登录", "UNAUTHORIZED", 401);
    return this.players[s.playerId];
  }
  find(id) {
    return Object.values(this.rooms).find((r) =>
      r.players.some((p) => p.id === id),
    );
  }
  member(id, code) {
    const r = this.rooms[code];
    if (!r) fail("房间不存在或已关闭", "NOT_FOUND", 404);
    if (!r.players.some((p) => p.id === id))
      fail("你不在这个房间中", "FORBIDDEN", 403);
    return r;
  }
  online(p) {
    if (p.isBot) return true;
    return !p.away && this.now() - (this.presence[p.id] ?? p.lastSeen) < 25000;
  }
  touch(id, r) {
    const p = r.players.find((p) => p.id === id);
    const was = this.online(p);
    this.presence[id] = this.now();
    p.away = false;
    if (!was) this.changed(r);
  }
  changed(r) {
    r.revision++;
    r.updatedAt = this.now();
    this.save();
    this.emit(r.code);
  }
  current(id) {
    const r = this.find(id);
    return r ? this.view(id, r.code) : null;
  }
  view(id, code) {
    const r = this.member(id, code);
    return {
      code: r.code,
      revision: r.revision,
      hostId: r.hostId,
      status: r.status,
      me: id,
      serverNow: this.now(),
      players: r.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: !!p.isBot,
        ready: p.ready,
        online: this.online(p),
      })),
      game: r.game ? E.project(r.game, id) : null,
    };
  }
  seat(id) {
    const p = this.players[id];
    if (!p) fail("请重新登录", "UNAUTHORIZED", 401);
    this.presence[id] = this.now();
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: !!p.isBot,
      ready: false,
      away: false,
      lastSeen: this.now(),
    };
  }
  create(id) {
    if (this.find(id)) fail("请先离开当前房间；对局中需等待结束");
    let code;
    do {
      code = String(crypto.randomInt(100000, 1000000));
    } while (this.rooms[code]);
    const r = {
      code,
      hostId: id,
      revision: 1,
      status: "waiting",
      players: [this.seat(id)],
      game: null,
      commands: {},
      updatedAt: this.now(),
      offlineSince: null,
    };
    this.rooms[code] = r;
    this.save();
    return this.view(id, code);
  }
  join(id, code) {
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      fail("请输入 6 位房间号");
    const r = this.rooms[code];
    if (!r) fail("房间不存在或已关闭", "NOT_FOUND", 404);
    const current = this.find(id);
    if (current && current.code !== code) fail("你已在另一个房间");
    if (r.players.some((p) => p.id === id)) {
      this.touch(id, r);
      return this.view(id, code);
    }
    if (r.status !== "waiting") fail("这个房间已经开始");
    if (r.players.length >= 5) fail("房间已满");
    r.players.push(this.seat(id));
    r.players.forEach((p) => (p.ready = !!p.isBot));
    this.changed(r);
    return this.view(id, code);
  }
  command(id, code, a) {
    let r = this.member(id, code);
    if (
      !a ||
      typeof a.commandId !== "string" ||
      a.commandId.length < 1 ||
      a.commandId.length > 100
    )
      fail("缺少命令标识");
    const key = id + ":" + a.commandId;
    const signature = hash(JSON.stringify(a));
    const prior = r.commands[key];
    if (prior) {
      if (prior !== signature) fail("命令标识已经用于其他操作");
      return this.view(id, code);
    }
    if (a.revision !== r.revision)
      fail("状态已更新，请重新确认操作", "STALE", 409);
    const me = r.players.find((p) => p.id === id);
    const active = r.status === "playing";
    // Clone before validation so rejected operations cannot mutate the authoritative room.
    const n = copy(r);
    const self = n.players.find((p) => p.id === id);
    if (a.type === "addBots") {
      if (!this.allowBots)
        fail("验证 Bot 仅在本地开发模式可用", "FORBIDDEN", 403);
      if (n.hostId !== id || self.isBot || n.status !== "waiting")
        fail("仅房主能在准备阶段添加 Bot", "FORBIDDEN", 403);
      if (
        !Number.isInteger(a.count) ||
        a.count < 1 ||
        a.count > 4 ||
        n.players.length + a.count > 5
      )
        fail("请选择 1–4 只 Bot，总人数不能超过 5 人");
      if (typeof a.respondNope !== "boolean") fail("Bot 否定设置不正确");
      n.players.forEach((p) => (p.ready = !!p.isBot));
      for (let i = 0; i < a.count; i++) {
        const number = n.players.filter((p) => p.isBot).length + 1;
        const bot = {
          id: crypto.randomUUID(),
          name: "陪练猫 " + number,
          avatar: number % 4,
          isBot: true,
          ready: true,
          away: false,
          respondNope: a.respondNope,
          lastSeen: this.now(),
        };
        n.players.push(bot);
      }
    } else if (a.type === "ready") {
      if (n.status !== "waiting") fail("现在不能准备");
      if (typeof a.ready !== "boolean") fail("准备状态不正确");
      self.ready = a.ready;
    } else if (a.type === "start") {
      if (n.hostId !== id) fail("仅房主可以开始");
      if (
        n.status !== "waiting" ||
        n.players.length < 2 ||
        !n.players.every((p) => p.ready)
      )
        fail("需要至少 2 人且全员准备");
      n.game = E.createGame(
        n.players.map(({ id, name, avatar, isBot }) => ({
          id,
          name,
          avatar,
          isBot: !!isBot,
        })),
        { now: this.now() },
      );
      n.status = "playing";
    } else if (a.type === "rematch") {
      if (!["finished", "aborted"].includes(n.status)) fail("请等待本局结束");
      if (n.hostId !== id) fail("请让房主开启下一局");
      n.status = "waiting";
      n.game = null;
      n.players.forEach((p) => {
        p.ready = !!p.isBot;
        p.away = false;
      });
    } else if (a.type === "leave") {
      if (active) {
        self.away = true;
      } else {
        n.players = n.players.filter((p) => p.id !== id);
        n.players.forEach((p) => (p.ready = !!p.isBot));
        if (n.hostId === id)
          n.hostId = n.players.find((p) => !p.isBot)?.id || null;
        if (!n.players.some((p) => !p.isBot)) n.players = [];
      }
    } else if (a.type === "kick") {
      if (
        n.status !== "waiting" ||
        n.hostId !== id ||
        id === a.target ||
        !n.players.some((p) => p.id === a.target)
      )
        fail("现在不能移除此玩家");
      n.players = n.players.filter((p) => p.id !== a.target);
      n.players.forEach((p) => (p.ready = !!p.isBot));
    } else {
      if (!active || !n.game) fail("当前不在对局中");
      if (a.gameId !== n.game.id) fail("对局已更新，请刷新", "STALE", 409);
      n.game = E.command(n.game, id, a, { now: this.now() });
      E.assertInvariant(n.game);
      if (self.isBot && a.type === "play") {
        // Save strategy progress atomically with the move so a restart cannot repeat it.
        const turn = [
          r.game.id,
          r.game.turnNumber || 0,
          r.game.current,
          r.game.remaining,
        ].join(":");
        self.botTurn = {
          turn,
          played: (self.botTurn?.turn === turn ? self.botTurn.played : 0) + 1,
        };
      }
      if (n.game.phase === "finished") n.status = "finished";
    }
    n.commands[key] = signature;
    const keys = Object.keys(n.commands);
    if (keys.length > 512) delete n.commands[keys[0]];
    this.rooms[code] = n;
    this.changed(n);
    if (!n.players.length) {
      delete this.rooms[code];
      this.save();
    }
    if (a.type === "leave" && !active) return null;
    return this.view(id, code);
  }
  tick() {
    const now = this.now();
    let dirty = false;
    for (const r of Object.values(this.rooms)) {
      const online = r.players.filter((p) => !p.isBot && this.online(p));
      if (online.length) {
        r.offlineSince = null;
        if (!online.some((p) => p.id === r.hostId)) {
          r.hostId = online[0].id;
          this.changed(r);
        }
      } else r.offlineSince ??= now;
      if (r.status === "playing") {
        if (!online.length && now - r.offlineSince >= 300000) {
          r.status = "aborted";
          r.game.phase = "finished";
          r.game.winner = null;
          r.game.deadline = null;
          r.game.pending = null;
          r.game.future = null;
          this.changed(r);
          continue;
        }
        try {
          const next = E.tick(r.game, { now });
          if (next !== r.game) {
            E.assertInvariant(next);
            r.game = next;
            if (next.phase === "finished") r.status = "finished";
            this.changed(r);
          }
        } catch (error) {
          this.abort(r);
          console.error(
            "对局异常中止",
            r.diagnosticId,
            error.code || error.name,
          );
          this.changed(r);
        }
      }
      const ttl = r.status === "waiting" ? 1800000 : 86400000;
      if (
        r.status !== "playing" &&
        !online.length &&
        now - (r.offlineSince ?? now) > ttl
      ) {
        delete this.rooms[r.code];
        this.emit(r.code);
        dirty = true;
      }
    }
    for (const [key, s] of Object.entries(this.sessions))
      if (s.expires <= now) {
        delete this.sessions[key];
        dirty = true;
      }
    if (dirty) this.save();
  }
}
module.exports = { RoomService, ServiceError };
