const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server/index");
const { RoomService } = require("../server/rooms");
async function fixture(t, options = {}) {
  const server = createServer({ service: new RoomService(), ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  const base = "http://127.0.0.1:" + server.address().port;
  return async (path, body, token) => {
    const res = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
}
test("HTTP 身份、建房、准备、开始与权限闭环", async (t) => {
  const req = await fixture(t);
  const a = (await req("/api/session", { name: "小白" })).data;
  const b = (await req("/api/session", { name: "小雨" })).data;
  assert.equal((await req("/api/rooms", {})).status, 401);
  let r = (await req("/api/rooms", {}, a.token)).data;
  assert.equal((await req("/api/rooms/" + r.code, null, b.token)).status, 403);
  r = (await req("/api/rooms/join", { code: r.code }, b.token)).data;
  for (const [i, p] of [a, b].entries()) {
    r = (
      await req(
        "/api/rooms/" + r.code + "/command",
        {
          commandId: "ready" + i,
          revision: r.revision,
          type: "ready",
          ready: true,
        },
        p.token,
      )
    ).data;
  }
  r = (
    await req(
      "/api/rooms/" + r.code + "/command",
      { commandId: "start", revision: r.revision, type: "start" },
      a.token,
    )
  ).data;
  assert.equal(r.status, "playing");
  assert.equal(r.game.hand.length, 8);
  assert.equal(r.game.deckCount, 35);
  assert(r.game.players.every((p) => !p.hand));
  const response = await req("/api/rooms/current", null, b.token);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.data.code, r.code);
});
test("生产身份不接受客户端伪造 playerId/openid", async (t) => {
  const req = await fixture(t, {
    mode: "wechat",
    exchangeCode: async (code) => {
      if (code === "valid") return "real-open-id";
      throw Error("invalid");
    },
  });
  assert.equal(
    (
      await req("/api/session", {
        name: "猫",
        playerId: "fake",
        openid: "fake",
      })
    ).status,
    400,
  );
  const a = await req("/api/session", { code: "valid", name: "猫" });
  assert.equal(a.status, 200);
  const b = await req("/api/session", { code: "valid", name: "新猫" });
  assert.equal(a.data.player.id, b.data.player.id);
  assert(!JSON.stringify(a.data).includes("real-open-id"));
});
test("无认证不能长轮询，不暴露敏感源文件", async (t) => {
  const req = await fixture(t);
  assert.equal((await req("/api/rooms/123456?after=1")).status, 401);
  assert.equal((await req("/server/rooms.js")).status, 404);
  assert.equal((await req("/.env")).status, 404);
});
test("长轮询在房间改变后返回新版本，重复命令不会重复开局", async (t) => {
  const req = await fixture(t, { pollMs: 1000 });
  const a = (await req("/api/session", { name: "同步猫" })).data;
  let r = (await req("/api/rooms", {}, a.token)).data;
  const waiting = req(
    "/api/rooms/" + r.code + "?after=" + r.revision,
    null,
    a.token,
  );
  const c = {
    commandId: "ready-one",
    revision: r.revision,
    type: "ready",
    ready: true,
  };
  r = (await req("/api/rooms/" + r.code + "/command", c, a.token)).data;
  const event = await waiting;
  assert.equal(event.status, 200);
  assert.equal(event.data.revision, r.revision);
  assert.equal(event.data.players[0].ready, true);
  const again = await req("/api/rooms/" + r.code + "/command", c, a.token);
  assert.equal(again.data.revision, r.revision);
});
test("HTTP 资料修改仅属于当前会话", async (t) => {
  const req = await fixture(t);
  const a = (await req("/api/session", { name: "旧昵称" })).data;
  const profile = await req(
    "/api/profile",
    { name: "新昵称", avatar: 2, playerId: "fake" },
    a.token,
  );
  assert.equal(profile.data.id, a.player.id);
  const r = (await req("/api/rooms", {}, a.token)).data;
  assert.equal(r.players[0].name, "新昵称");
});
test("本地房主可添加 Bot，旧版本与非房主不能添加，命令重发不重复占位", async (t) => {
  const req = await fixture(t);
  const a = (await req("/api/session", { name: "房主" })).data;
  const b = (await req("/api/session", { name: "朋友" })).data;
  let r = (await req("/api/rooms", {}, a.token)).data;
  r = (await req("/api/rooms/join", { code: r.code }, b.token)).data;
  const action = {
    count: 2,
    respondNope: false,
    revision: r.revision,
    commandId: "add-bots-once",
  };
  assert.equal(
    (await req("/api/rooms/" + r.code + "/bots", action, b.token)).status,
    403,
  );
  assert.equal(
    (
      await req(
        "/api/rooms/" + r.code + "/bots",
        { ...action, revision: 0 },
        a.token,
      )
    ).status,
    409,
  );
  const added = await req("/api/rooms/" + r.code + "/bots", action, a.token);
  assert.equal(added.status, 200);
  assert.equal(added.data.players.filter((p) => p.isBot).length, 2);
  const repeated = await req("/api/rooms/" + r.code + "/bots", action, a.token);
  assert.equal(repeated.data.players.length, 4);
  assert.equal(
    (
      await req(
        "/api/rooms/" + r.code + "/command",
        {
          ...action,
          type: "addBots",
          commandId: "bypass",
          revision: added.data.revision,
        },
        a.token,
      )
    ).status,
    403,
  );
});
test("微信生产模式即使身份有效也不能使用 Bot 接口", async (t) => {
  const req = await fixture(t, {
    mode: "wechat",
    exchangeCode: async () => "valid-owner",
  });
  const a = (await req("/api/session", { name: "真人", code: "valid" })).data;
  const r = (await req("/api/rooms", {}, a.token)).data;
  const response = await req(
    "/api/rooms/" + r.code + "/bots",
    {
      count: 1,
      respondNope: false,
      revision: r.revision,
      commandId: "prod-bot",
    },
    a.token,
  );
  assert.equal(response.status, 403);
  assert.equal(
    (await req("/api/rooms/" + r.code, null, a.token)).data.players.length,
    1,
  );
});
test("HTTP 建房传递不限时布尔选项，拒绝其他值且过滤时长覆盖", async (t) => {
  const req = await fixture(t);
  const a = (await req("/api/session", { name: "不限时猫" })).data;
  for (const noTurnTimer of [null, 1, "false", {}, []]) {
    const response = await req("/api/rooms", { noTurnTimer }, a.token);
    assert.equal(response.status, 400);
  }
  const made = await req(
    "/api/rooms",
    { noTurnTimer: true, nope: 1, action: 1, rules: { nope: 1 } },
    a.token,
  );
  assert.equal(made.status, 200);
  assert.deepEqual(made.data.options, { noTurnTimer: true });
  const b = (await req("/api/session", { name: "普通猫" })).data;
  const normal = await req("/api/rooms", {}, b.token);
  assert.deepEqual(normal.data.options, { noTurnTimer: false });
});

// Exercise the real HTTP handler with the socket source seen from a phone.
async function lanRequest(
  server,
  path,
  data,
  { debugToken, token, address = "192.168.0.22", forwarded } = {},
) {
  const { Readable } = require("node:stream");
  const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
  req.url = path;
  req.method = data === undefined ? "GET" : "POST";
  req.socket = { remoteAddress: address };
  req.headers = {
    "content-type": "application/json",
    ...(debugToken ? { "x-boomcat-debug": debugToken } : {}),
    ...(token ? { authorization: "Bearer " + token } : {}),
    ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
  };
  return new Promise((resolve) => {
    const res = {
      writableEnded: false,
      destroyed: false,
      setHeader() {},
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        this.writableEnded = true;
        resolve({ status: this.status, data: JSON.parse(body) });
      },
    };
    server.emit("request", req, res);
  });
}
test("真机私网HTTP登录建房Bot需访问码，转发头不能替代真实来源", async (t) => {
  const debugToken = "c".repeat(64);
  const server = createServer({
    service: new RoomService(),
    lanToken: debugToken,
  });
  t.after(() => server.close());
  assert.equal(
    (await lanRequest(server, "/api/session", { name: "手机" })).status,
    403,
  );
  assert.equal(
    (
      await lanRequest(
        server,
        "/api/session",
        { name: "手机" },
        { debugToken: "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await lanRequest(
        server,
        "/api/session",
        { name: "手机" },
        { debugToken, address: "203.0.113.2", forwarded: "127.0.0.1" },
      )
    ).status,
    403,
  );
  const session = await lanRequest(
    server,
    "/api/session",
    { name: "手机" },
    { debugToken },
  );
  assert.equal(session.status, 200);
  const token = session.data.token;
  assert.equal(
    (await lanRequest(server, "/api/rooms", {}, { token })).status,
    403,
  );
  const made = await lanRequest(
    server,
    "/api/rooms",
    { noTurnTimer: true },
    { debugToken, token },
  );
  assert.equal(made.status, 200);
  const r = made.data;
  const bots = await lanRequest(
    server,
    "/api/rooms/" + r.code + "/bots",
    {
      count: 1,
      respondNope: false,
      revision: r.revision,
      commandId: "phone-bot",
    },
    { debugToken, token },
  );
  assert.equal(bots.status, 200);
  assert.equal(bots.data.players.length, 2);
  assert.equal(
    (
      await lanRequest(server, "/api/rooms/" + r.code, undefined, {
        debugToken,
        token,
      })
    ).status,
    200,
  );
  const health = await lanRequest(server, "/api/health");
  assert.equal(health.data.phoneDebug, true);
  assert(!JSON.stringify(health.data).includes(debugToken));
});
test("普通服务不会因为手机请求头而开启LAN身份，正式模式禁止LAN访问码配置", async (t) => {
  const server = createServer({ service: new RoomService() });
  t.after(() => server.close());
  assert.equal(
    (
      await lanRequest(
        server,
        "/api/session",
        { name: "手机" },
        { debugToken: "c".repeat(64) },
      )
    ).status,
    403,
  );
  assert.throws(
    () => createServer({ mode: "wechat", lanToken: "c".repeat(64) }),
    /只能用于本地开发/,
  );
});
