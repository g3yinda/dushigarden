"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { RoomService, ServiceError } = require("./rooms");
const cards = require("../shared/cards");
function send(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!String(req.headers["content-type"]).startsWith("application/json"))
    throw new ServiceError("请使用 JSON 请求", "BAD_REQUEST", 415);
  let text = "";
  for await (const part of req) {
    text += part;
    if (Buffer.byteLength(text) > 8192)
      throw new ServiceError("请求过大", "BAD_REQUEST", 413);
  }
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new ServiceError("请求格式不正确", "BAD_REQUEST", 400);
  }
}
async function exchangeWechatCode(code) {
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({
    appid: process.env.WX_APP_ID,
    secret: process.env.WX_APP_SECRET,
    js_code: code,
    grant_type: "authorization_code",
  }).toString();
  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw Error();
    data = await res.json();
  } catch {
    throw new ServiceError(
      "微信登录暂时不可用，请稍后再试",
      "LOGIN_UNAVAILABLE",
      503,
    );
  }
  if (!data.openid || data.errcode)
    throw new ServiceError("微信登录已过期，请重试", "LOGIN_FAILED", 401);
  return data.openid;
}
function createServer({
  service = new RoomService(),
  mode = "local",
  exchangeCode = exchangeWechatCode,
  pollMs = 20000,
} = {}) {
  const limits = new Map();
  const waiting = new Map();
  const web = path.resolve(__dirname, "../web");
  function limit(key, max, windowMs = 60000) {
    const now = Date.now();
    let r = limits.get(key);
    if (!r || now >= r.until) {
      r = { count: 0, until: now + windowMs };
      limits.set(key, r);
    }
    if (++r.count > max)
      throw new ServiceError("操作太频繁，请稍后再试", "RATE_LIMIT", 429);
  }
  function error(res, e) {
    send(res, e.status || (e.code === "STALE" ? 409 : e.code ? 400 : 500), {
      error: e.code || "INTERNAL_ERROR",
      message: e.code ? e.message : "服务暂时不可用，请重试",
    });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const url = new URL(req.url, "http://localhost");
      const route = url.pathname;
      const address = req.socket.remoteAddress;
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
      if (route.startsWith("/api/")) {
        limit("ip:" + address, 600);
        if (route === "/api/health" && req.method === "GET")
          return send(res, 200, { ok: true, mode });
        if (route === "/api/cards" && req.method === "GET")
          return send(res, 200, cards);
        if (route === "/api/session" && req.method === "POST") {
          limit("login:" + address, 30);
          const b = await body(req);
          let identity = null;
          if (mode === "wechat") {
            if (typeof b.code !== "string" || !b.code || b.code.length > 256)
              throw new ServiceError("缺少微信登录凭证");
            identity = await exchangeCode(b.code);
          } else if (!local)
            throw new ServiceError("开发身份仅允许本机访问", "FORBIDDEN", 403);
          return send(res, 200, service.session(b, identity));
        }
        const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
          req.headers.authorization || "",
        );
        const p = service.authenticate(match?.[1]);
        limit("player:" + p.id, 240);
        service.tick();
        if (route === "/api/profile" && req.method === "POST")
          return send(res, 200, service.profile(p.id, await body(req)));
        if (route === "/api/rooms/current" && req.method === "GET") {
          const r = service.current(p.id);
          if (r) service.touch(p.id, service.member(p.id, r.code));
          return send(res, 200, service.current(p.id));
        }
        if (route === "/api/rooms" && req.method === "POST") {
          await body(req);
          limit("create:" + p.id, 10);
          return send(res, 200, service.create(p.id));
        }
        if (route === "/api/rooms/join" && req.method === "POST") {
          limit("join:" + p.id, 20);
          const b = await body(req);
          return send(res, 200, service.join(p.id, b.code));
        }
        const room = /^\/api\/rooms\/(\d{6})(\/command)?$/.exec(route);
        if (room) {
          const code = room[1];
          if (room[2] && req.method === "POST") {
            const b = await body(req);
            return send(res, 200, service.command(p.id, code, b));
          }
          if (!room[2] && req.method === "GET") {
            const r = service.member(p.id, code);
            service.touch(p.id, r);
            const after = Number(url.searchParams.get("after"));
            if (!url.searchParams.has("after") || after !== r.revision)
              return send(res, 200, service.view(p.id, code));
            const count = waiting.get(p.id) || 0;
            if (count >= 3)
              throw new ServiceError("同步连接过多", "RATE_LIMIT", 429);
            waiting.set(p.id, count + 1);
            let done = false;
            let timer;
            const cleanup = () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              service.off(code, reply);
              waiting.set(p.id, Math.max(0, (waiting.get(p.id) || 1) - 1));
            };
            const reply = () => {
              if (done) return;
              cleanup();
              try {
                send(res, 200, service.view(p.id, code));
              } catch (e) {
                error(res, e);
              }
            };
            timer = setTimeout(reply, pollMs);
            service.on(code, reply);
            res.on("close", cleanup);
            return;
          }
        }
        return send(res, 404, { error: "NOT_FOUND", message: "接口不存在" });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, {
          error: "METHOD_NOT_ALLOWED",
          message: "不支持此请求",
        });
      const relative =
        route === "/"
          ? "index.html"
          : decodeURIComponent(route).replace(/^\/+/, "");
      if (
        relative.split("/").some((s) => s.startsWith(".")) ||
        !/^[-a-zA-Z0-9_/.]+$/.test(relative)
      )
        return send(res, 404, { error: "NOT_FOUND", message: "页面不存在" });
      const target = path.resolve(web, relative);
      if (
        !target.startsWith(web + path.sep) ||
        !fs.existsSync(target) ||
        !fs.statSync(target).isFile()
      )
        return send(res, 404, { error: "NOT_FOUND", message: "页面不存在" });
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      }[path.extname(target)];
      if (!mime)
        return send(res, 404, { error: "NOT_FOUND", message: "页面不存在" });
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(target).pipe(res);
    } catch (e) {
      error(res, e);
    }
  });
  const timer = setInterval(() => {
    try {
      service.tick();
      for (const [key, value] of limits)
        if (Date.now() > value.until) limits.delete(key);
    } catch (e) {
      console.error("房间维护失败", e.code || e.name);
    }
  }, 1000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  return server;
}
if (require.main === module) {
  const mode = process.env.NODE_ENV === "production" ? "wechat" : "local";
  if (
    mode === "wechat" &&
    (!process.env.WX_APP_ID || !process.env.WX_APP_SECRET)
  )
    throw new Error("生产模式需要 WX_APP_ID 和 WX_APP_SECRET");
  const service = new RoomService({
    file:
      process.env.DATA_FILE || path.resolve(__dirname, "../.data/state.json"),
  });
  const server = createServer({ service, mode });
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`朋友局已启动 http://${host}:${port} (${mode})`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
}
module.exports = { createServer };
