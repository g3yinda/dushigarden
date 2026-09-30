"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
require("./client-config").ensureClientConfig();
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
const source = [
  "server",
  "shared",
  "web",
  "miniprogram",
  "test",
  "tests",
  "tools",
].flatMap((dir) => walk(path.join(root, dir)));
for (const file of source.filter((f) => f.endsWith(".js"))) {
  const r = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
}
const project = JSON.parse(
    fs.readFileSync(path.join(root, "project.config.json")),
  ),
  app = JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json")));
assert.match(project.appid, /^wx[0-9a-f]{16}$/);
assert.equal(project.miniprogramRoot, "miniprogram/");
for (const page of app.pages) {
  for (const ext of ["js", "json", "wxml", "wxss"])
    assert(
      fs.existsSync(path.join(root, "miniprogram", page + "." + ext)),
      `${page}.${ext} 缺失`,
    );
}
for (const name of ["core.jpg", "cats.jpg", "ui.jpg"]) {
  assert(fs.existsSync(path.join(root, "miniprogram/assets", name)));
  assert(fs.existsSync(path.join(root, "web", name)));
}
assert.equal(
  fs.readFileSync(path.join(root, "web/controller.js"), "utf8"),
  fs.readFileSync(path.join(root, "miniprogram/lib/controller.js"), "utf8"),
  "两端控制器必须一致",
);
const packageSize = walk(path.join(root, "miniprogram")).reduce(
  (n, p) => n + fs.statSync(p).size,
  0,
);
assert(packageSize < 2 * 1024 * 1024, "小程序资源超过 2 MiB");
console.log(
  `语法、配置、页面与资源检查通过；小程序源码包约 ${(packageSize / 1024 / 1024).toFixed(2)} MiB。`,
);
if (process.argv.includes("--release")) {
  const config = require("../miniprogram/config");
  assert.notEqual(config.publicPreview, true, "正式发布前移除公网测试配置");
  assert.equal(
    config.phoneDebug === true,
    false,
    "正式发布前移除整个真机调试配置",
  );
  assert.equal(config.debugToken || "", "", "正式发布前移除真机调试访问码");
  assert.equal(config.localMode, false, "正式发布前关闭本地身份模式");
  assert.match(config.apiBase, /^https:\/\//, "正式发布需要 HTTPS 后端");
  assert.equal(project.setting.urlCheck, true, "正式发布前启用合法域名检查");
  console.log("发布配置检查通过。");
}
