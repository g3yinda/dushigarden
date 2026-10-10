"use strict";
const { isIP } = require("node:net");

// Only report categories. Actual configuration can contain private access codes.
function releaseConfigIssues(config, project) {
  const issues = [];
  if (config.publicPreview === true) issues.push("移除公网测试配置（publicPreview）");
  if (config.phoneDebug === true) issues.push("移除真机调试配置（phoneDebug）");
  if (config.debugToken) issues.push("移除客户端调试访问码（debugToken）");
  if (config.localMode !== false) issues.push("关闭本地测试身份，启用真实微信登录（localMode=false）");
  if (config.transport === "cloudrun") {
    for (const field of ["cloudEnv", "cloudRunEnv"])
      if (!/^[a-z0-9][a-z0-9-]{4,63}$/.test(config[field] || "")) issues.push(`配置有效的云环境标识（${field}）`);
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(config.cloudService || "")) issues.push("配置云托管服务名称（cloudService）");
  } else {
    if (config.transport && config.transport !== "http") issues.push("请求传输方式仅支持http或cloudrun");
    try {
    const endpoint = new URL(config.apiBase);
    const host = endpoint.hostname.toLowerCase();
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
        endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
      issues.push("后端必须使用无凭据、端口、路径或查询参数的 HTTPS 域名地址");
    }
    if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") ||
        /(?:^|\.)(?:localhost|local|invalid|test)$/.test(host) ||
        /(?:^|\.)example\.(?:com|org|net)$/.test(host) ||
        /(?:^|\.)trycloudflare\.com$/.test(host)) {
      issues.push("使用自己的正式后端域名，不能使用 IP、本地、示例或临时隧道地址");
    }
    } catch {
      issues.push("配置有效的正式 HTTPS 后端域名地址（apiBase）");
    }
  }
  if (project.setting?.urlCheck !== true) issues.push("开启微信开发工具合法域名检查（urlCheck=true）");
  return issues;
}

module.exports = { releaseConfigIssues };
