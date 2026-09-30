const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
test("普通服务启动端口冲突时不能覆盖已经可用的手机配置", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "boomcat-startup-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const file of [
    "server/index.js",
    "server/engine.js",
    "server/rooms.js",
    "server/bots.js",
    "server/debug-access.js",
    "shared/cards.js",
    "tools/client-config.js",
  ]) {
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", file), target);
  }
  fs.mkdirSync(path.join(temp, "miniprogram"));
  const config = path.join(temp, "miniprogram/config.js");
  fs.writeFileSync(config, "existing-phone-debug-config");
  const holder = http.createServer();
  holder.listen(0, "127.0.0.1");
  await once(holder, "listening");
  t.after(() => new Promise((resolve) => holder.close(resolve)));
  const child = spawn(process.execPath, [path.join(temp, "server/index.js")], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(holder.address().port),
      DATA_FILE: path.join(temp, "state.json"),
    },
    signal: AbortSignal.timeout(5000),
  });
  let error = "";
  child.stderr.on("data", (chunk) => (error += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(error, /EADDRINUSE/);
  assert.equal(fs.readFileSync(config, "utf8"), "existing-phone-debug-config");
});
