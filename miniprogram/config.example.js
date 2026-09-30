// 正式部署时复制为 config.js，填入自己的 HTTPS 域名并配置 request 合法域名。
// 本地模拟器：npm start 自动生成 config.js；同 Wi-Fi 真机：npm run dev:phone 自动生成。
module.exports = {
  apiBase: "https://api.example.com",
  localMode: false,
  debugToken: "",
};
