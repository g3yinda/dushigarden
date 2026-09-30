"use strict";
const fs = require("node:fs");
const path = require("node:path");
function clientConfigSource({
  apiBase = "http://127.0.0.1:8787",
  lanApiBase = "",
  debugToken = "",
  localMode = true,
  publicPreview = false,
} = {}) {
  if (publicPreview) {
    const endpoint = new URL(apiBase);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash)
      throw new Error("公网测试需要不含凭据或路径的 HTTPS 地址");
    if (!/^[a-f0-9]{64}$/.test(debugToken)) throw new Error("公网测试访问码无效");
    if (!localMode || lanApiBase) throw new Error("公网测试配置必须单独使用测试身份");
  }
  return (
    `// Generated local configuration. Never commit this file.\n` +
    `let platform = "devtools";\n` +
    `if (typeof wx !== "undefined") {\n  try { platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform; } catch (_) {}\n}\n` +
    `const phone = platform === "ios" || platform === "android";\n` +
    `module.exports = {\n  apiBase: phone && ${JSON.stringify(!!lanApiBase)} ? ${JSON.stringify(lanApiBase)} : ${JSON.stringify(apiBase)},\n  localMode: ${JSON.stringify(localMode)},\n  phoneDebug: ${JSON.stringify(!!lanApiBase || !!debugToken || publicPreview)},\n  publicPreview: ${JSON.stringify(publicPreview)},\n  debugToken: phone || ${JSON.stringify(publicPreview)} ? ${JSON.stringify(debugToken)} : ""\n};\n`
  );
}
function writeClientConfig(
  options,
  file = path.resolve(__dirname, "../miniprogram/config.js"),
) {
  fs.writeFileSync(file, clientConfigSource(options), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
function ensureClientConfig() {
  const file = path.resolve(__dirname, "../miniprogram/config.js");
  if (!fs.existsSync(file)) writeClientConfig();
}
module.exports = { clientConfigSource, writeClientConfig, ensureClientConfig };
