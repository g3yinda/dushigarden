"use strict";
const fs = require("node:fs"), path = require("node:path");
const { releaseConfigIssues } = require("./release-config");

function configureCloudrun({ root = path.resolve(__dirname, ".."), apply = false } = {}) {
  const config = require("../miniprogram/config.cloudrun.example");
  const projectFile = path.join(root, "project.config.json");
  const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  const privateProjectFile = path.join(root, "project.private.config.json");
  const privateProject = fs.existsSync(privateProjectFile)
    ? JSON.parse(fs.readFileSync(privateProjectFile, "utf8")) : null;
  if (project.appid !== "wxf7af6d01a9bbfdbd") throw Error("当前云环境只配置给已确认的小游戏AppID");
  project.setting ||= {};
  project.setting.urlCheck = true;
  const issues = releaseConfigIssues(config, project);
  if (issues.length) throw Error(issues.join("\n"));
  if (!apply) return { applied: false };
  const configFile = path.join(root, "miniprogram/config.js");
  let backupPath = "";
  if (fs.existsSync(configFile)) {
    const backupDir = path.join(root, ".data");
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    backupPath = path.join(backupDir, `client-config-before-cloudrun-${Date.now()}-${process.pid}.js`);
    fs.copyFileSync(configFile, backupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backupPath, 0o600);
  }
  fs.writeFileSync(configFile, fs.readFileSync(path.join(__dirname, "../miniprogram/config.cloudrun.example.js")), { mode: 0o600 });
  fs.chmodSync(configFile, 0o600);
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + "\n");
  if (privateProject) {
    privateProject.setting ||= {};
    privateProject.setting.urlCheck = true;
    fs.writeFileSync(privateProjectFile, JSON.stringify(privateProject, null, 2) + "\n");
  }
  return { applied: true, backupPath };
}

if (require.main === module) {
  try {
    const result = configureCloudrun({ apply: process.argv.includes("--apply") });
    console.log(result.applied
      ? "客户端已切换云托管；旧配置已私有备份。请重新编译并验证真实登录和关闭调试对局。"
      : "云托管配置检查通过，未修改当前连接。服务运行后执行 npm run configure:cloudrun -- --apply 切换。");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { configureCloudrun };
