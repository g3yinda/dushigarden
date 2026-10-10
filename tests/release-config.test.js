"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseConfigIssues } = require("../tools/release-config");
const config = { apiBase: "https://api.cats-game.cn", localMode: false };
const project = { setting: { urlCheck: true } };

test("正式发布检查一次列出全部测试配置问题，不泄露访问码", () => {
  const issues = releaseConfigIssues({
    apiBase: "https://some-preview.trycloudflare.com",
    localMode: true, phoneDebug: true, publicPreview: true,
    debugToken: "private-value-never-print",
  }, { setting: { urlCheck: false } });
  assert.equal(issues.length, 6);
  for (const keyword of ["公网测试", "真机调试配置", "访问码", "身份", "临时", "域名检查"])
    assert(issues.some(issue => issue.includes(keyword)), keyword);
  assert(!issues.join(" ").includes("private-value-never-print"));
});

test("发布检查拒绝IP、本地、示例和带凭据或路径的地址，仅接受独立HTTPS域名", () => {
  for (const apiBase of [
    "http://api.cats-game.cn", "https://127.0.0.1", "https://43.142.80.120",
    "https://[::1]", "https://localhost", "https://api.local", "https://api.example.com",
    "https://api.cats-game.cn:8790", "https://api.cats-game.cn/api",
    "https://api.cats-game.cn?token=secret", "https://api.cats-game.cn#secret",
    "https://user:secret@api.cats-game.cn", "not-a-url", "",
  ]) {
    const issues = releaseConfigIssues({ ...config, apiBase }, project);
    assert(issues.length > 0, apiBase);
    assert(!issues.join(" ").includes("secret"));
  }
  assert.deepEqual(releaseConfigIssues(config, project), []);
  assert.deepEqual(releaseConfigIssues({ ...config, apiBase: config.apiBase + "/" }, project), []);
});

test("云托管正式配置不要求HTTP域名，必须具备两个环境、服务名和真实身份", () => {
  const cloud = { transport: "cloudrun", cloudEnv: "cloudbase-d7gs58am20088d298",
    cloudRunEnv: "prod-d2gqiy08z19bd1427", cloudService: "boomcat", localMode: false };
  assert.deepEqual(releaseConfigIssues(cloud, project), []);
  for (const field of ["cloudEnv", "cloudRunEnv", "cloudService"])
    assert(releaseConfigIssues({ ...cloud, [field]: "" }, project).length);
  assert(releaseConfigIssues({ ...cloud, debugToken: "private-value" }, project).length);
  assert(releaseConfigIssues({ ...cloud, localMode: true }, project).length);
  assert(releaseConfigIssues(cloud, { setting: { urlCheck: false } }).length);
  assert(releaseConfigIssues({ ...config, transport: "unknown" }, project).length);
});
