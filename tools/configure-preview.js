"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {clientConfigSource, writeClientConfig} = require("./client-config");
const apiBase = process.env.BOOMCAT_PREVIEW_URL;
const debugToken = process.env.BOOMCAT_PREVIEW_TOKEN;
if (!apiBase || !debugToken) throw Error("请通过私人 .env.preview 配置公网地址和访问码，不要把访问码放进命令行");
const options = {apiBase, debugToken, localMode: true, publicPreview: true};
clientConfigSource(options); // Validate before saving or replacing anything.
const config = path.resolve(__dirname, "../miniprogram/config.js");
const saved = path.resolve(__dirname, "../.data/client-before-public-preview.js");
if (fs.existsSync(config) && !fs.existsSync(saved)) {
  fs.mkdirSync(path.dirname(saved), {recursive:true});
  fs.copyFileSync(config, saved);
  fs.chmodSync(saved, 0o600);
}
writeClientConfig(options);
console.log("已配置微信公网真机调试：" + apiBase);
console.log("请在开发工具重新编译，并生成真机调试二维码。此配置不能上传为正式版。");
