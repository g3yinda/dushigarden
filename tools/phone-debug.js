"use strict";
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const { findLanAddresses } = require("../server/debug-access");
const { startServer } = require("../server/index");
const { writeClientConfig } = require("./client-config");
async function main() {
  if (process.env.NODE_ENV === "production")
    throw Error("真机调试仅用于本地开发，请不要设置 NODE_ENV=production");
  const addresses = findLanAddresses();
  const requested = process.argv
    .find((arg) => arg.startsWith("--host="))
    ?.slice(7);
  const host = requested || addresses[0];
  if (!host || !addresses.includes(host))
    throw Error(
      "没有找到可用的局域网 IPv4。请先让电脑与手机连接同一 Wi-Fi，再运行此命令。",
    );
  const port = Number(process.env.PORT || 8787);
  const lanToken = randomBytes(32).toString("hex");
  const server = startServer({
    mode: "local",
    host: "0.0.0.0",
    port,
    lanToken,
    announce: false,
  });
  await once(server, "listening");
  writeClientConfig({
    apiBase: `http://127.0.0.1:${port}`,
    lanApiBase: `http://${host}:${port}`,
    debugToken: lanToken,
  });
  console.log(`真机调试后端已启动。手机地址：http://${host}:${port}`);
  console.log(`模拟器与浏览器：http://127.0.0.1:${port}`);
  console.log(
    "手机与电脑连接同一 Wi-Fi；在微信工具重新编译，再生成真机调试二维码扫码。保持此终端运行。",
  );
  if (addresses.length > 1)
    console.log(
      `检测到多个地址：${addresses.join("、")}；必要时用 --host=电脑同 Wi-Fi 的地址指定。`,
    );
  return server;
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? "端口已被占用。请先停止原来的 npm start，再运行 npm run dev:phone。"
        : error.message,
    );
    process.exit(1);
  });
