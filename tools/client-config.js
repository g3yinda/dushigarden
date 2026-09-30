"use strict";
const fs = require("node:fs");
const path = require("node:path");
function clientConfigSource({
  apiBase = "http://127.0.0.1:8787",
  lanApiBase = "",
  debugToken = "",
  localMode = true,
} = {}) {
  return (
    `// Generated local configuration. Never commit this file.\n` +
    `let platform = "devtools";\n` +
    `if (typeof wx !== "undefined") {\n  try { platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform; } catch (_) {}\n}\n` +
    `const phone = platform === "ios" || platform === "android";\n` +
    `module.exports = {\n  apiBase: phone && ${JSON.stringify(!!lanApiBase)} ? ${JSON.stringify(lanApiBase)} : ${JSON.stringify(apiBase)},\n  localMode: ${JSON.stringify(localMode)},\n  phoneDebug: ${JSON.stringify(!!lanApiBase || !!debugToken)},\n  debugToken: phone ? ${JSON.stringify(debugToken)} : ""\n};\n`
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
