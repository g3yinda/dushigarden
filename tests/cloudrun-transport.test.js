"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApiTransport } = require("../miniprogram/lib/api-transport");
const config = {
  transport: "cloudrun", cloudEnv: "cloudbase-d7gs58am20088d298",
  cloudRunEnv: "prod-d2gqiy08z19bd1427", cloudService: "boomcat", localMode: false,
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function send(request, overrides = {}) {
  let task;
  const result = new Promise((resolve, reject) => {
    task = request({ path: "/api/rooms", method: "POST", data: { noTurnTimer: true },
      header: { Authorization: "Bearer synthetic-session" }, timeout: 200,
      success: resolve, fail: reject, ...overrides });
  });
  return { result, task };
}

test("HTTP链路仍使用wx.request，返回可取消任务并保留原有headers", async () => {
  let captured;
  const task = { abort() {} };
  const request = createApiTransport({ request(options) {
    captured = options; options.success({ statusCode: 200, data: {} }); return task;
  } }, { apiBase: "http://127.0.0.1:8787" });
  const call = send(request);
  await call.result;
  assert.equal(call.task, task);
  assert.equal(captured.url, "http://127.0.0.1:8787/api/rooms");
  assert.equal(captured.header.Authorization, "Bearer synthetic-session");
});

test("云托管初始化完成后调用；并发只初始化一次，环境和服务及25秒轮询准确", async () => {
  let finishInit, initCount = 0;
  const calls = [];
  const request = createApiTransport({ cloud: {
    init(options) {
      initCount++; assert.equal(options.env, config.cloudEnv);
      return new Promise(resolve => { finishInit = resolve; });
    },
    async callContainer(options) { calls.push(options); return { statusCode: 200, data: { ok: true } }; },
  }, request() { throw Error("不能退回HTTP"); } }, config);
  const first = send(request, { timeout: 25000 });
  const second = send(request);
  await tick(); assert.equal(initCount, 1); assert.equal(calls.length, 0);
  finishInit(); await Promise.all([first.result, second.result]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.env, config.cloudRunEnv);
  assert.equal(calls[0].header["X-WX-SERVICE"], "boomcat");
  assert.equal(calls[0].header.Authorization, "Bearer synthetic-session");
  assert.equal(calls[0].path, "/api/rooms");
  assert.equal(calls[0].timeout, 25000);
  assert.equal(calls[0].data.noTurnTimer, true);
});

test("云链路缺能力或配置不完整时明确失败，不能混用测试身份或泄露调试码", async () => {
  let calls = 0;
  const wx = { cloud: { init() {}, callContainer() { calls++; } }, request() { throw Error("不允许HTTP回退"); } };
  for (const badConfig of [{ ...config, cloudService: "" }, { ...config, localMode: true }, { ...config, debugToken: "private-value" }]) {
    await assert.rejects(send(createApiTransport(wx, badConfig)).result, error => {
      assert.equal(error.code, "CLOUD_CONFIG");
      assert(!JSON.stringify(error).includes("private-value")); return true;
    });
  }
  await assert.rejects(send(createApiTransport({}, config)).result, error => error.code === "CLOUD_UNAVAILABLE");
  assert.equal(calls, 0);
});

test("云请求取消后只回调一次，迟到响应不会更新页面，初始化中取消不发送请求", async () => {
  let resolveResponse, calls = 0, completed = 0;
  const request = createApiTransport({ cloud: { init() {}, callContainer() {
    calls++; return new Promise(resolve => { resolveResponse = resolve; });
  } } }, config);
  const waiting = send(request, { success() { completed++; }, fail(error) { completed++; assert.match(error.errMsg, /abort/); } });
  await tick(); waiting.task.abort(); waiting.task.abort();
  resolveResponse({ statusCode: 200, data: {} }); await tick();
  assert.equal(completed, 1); assert.equal(calls, 1);
  const cancelled = send(request);
  cancelled.task.abort();
  await assert.rejects(cancelled.result, error => /abort/.test(error.errMsg));
  await tick(); assert.equal(calls, 1);
});

test("云请求超时后忽略迟到响应；权限错误会保留安全分类，HTTP业务状态保持", async () => {
  let resolveResponse;
  const request = createApiTransport({ cloud: { init() {}, callContainer() {
    return new Promise(resolve => { resolveResponse = resolve; });
  } } }, config);
  const call = send(request, { timeout: 15 });
  await assert.rejects(call.result, error => /timeout/.test(error.errMsg));
  resolveResponse({ statusCode: 200, data: {} }); await tick();
  const denied = createApiTransport({ cloud: { init() {}, async callContainer() {
    throw { errCode: -501000, errMsg: "Your server is Forbidden For CallContainer. token=private-value" };
  } } }, config);
  await assert.rejects(send(denied).result, error => {
    assert.equal(error.code, "CLOUD_FORBIDDEN");
    assert(!JSON.stringify(error).includes("private-value")); return true;
  });
  const business = createApiTransport({ cloud: { init() {}, async callContainer() {
    return { statusCode: 401, data: { message: "登录已过期" } };
  } } }, config);
  assert.equal((await send(business).result).statusCode, 401);
});
