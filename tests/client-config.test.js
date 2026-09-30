const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { clientConfigSource } = require("../tools/client-config");
const token = "b".repeat(64);
function load(platform) {
  const context = {
    module: { exports: {} },
    ...(platform ? { wx: { getDeviceInfo: () => ({ platform }) } } : {}),
  };
  vm.runInNewContext(
    clientConfigSource({
      lanApiBase: "http://192.168.0.107:8787",
      debugToken: token,
    }),
    context,
  );
  return context.module.exports;
}
test("同一真机调试包在手机选电脑LAN地址，在模拟器保持回环地址", () => {
  for (const platform of ["ios", "android"]) {
    const config = load(platform);
    assert.equal(config.apiBase, "http://192.168.0.107:8787");
    assert.equal(config.debugToken, token);
    assert.equal(config.localMode, true);
  }
  for (const platform of ["devtools", undefined]) {
    const config = load(platform);
    assert.equal(config.apiBase, "http://127.0.0.1:8787");
    assert.equal(config.debugToken, "");
  }
});
test("普通配置不包含真机调试访问码，手机没有配置时也不悄悄接入LAN", () => {
  const context = {
    module: { exports: {} },
    wx: { getDeviceInfo: () => ({ platform: "ios" }) },
  };
  vm.runInNewContext(clientConfigSource(), context);
  assert.equal(context.module.exports.apiBase, "http://127.0.0.1:8787");
  assert.equal(context.module.exports.debugToken, "");
});
test("发布检查可识别整个包含真机调试配置，即便Node环境不使用调试码", () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(
    clientConfigSource({
      apiBase: "https://api.example.com",
      localMode: false,
      lanApiBase: "http://192.168.0.107:8787",
      debugToken: token,
    }),
    context,
  );
  assert.equal(context.module.exports.phoneDebug, true);
});
test('公网测试包在模拟器/iOS/Android 使用相同HTTPS后端和访问码，不能被发布检查误认正式包',()=>{
  for (const platform of ['devtools','ios','android']) {
    const context={module:{exports:{}},wx:{getDeviceInfo:()=>({platform})}};
    vm.runInNewContext(clientConfigSource({apiBase:'https://preview.example.com',debugToken:token,publicPreview:true}),context);
    const config=context.module.exports;
    assert.equal(config.apiBase,'https://preview.example.com'); assert.equal(config.debugToken,token);
    assert.equal(config.phoneDebug,true); assert.equal(config.publicPreview,true);
    assert.equal(config.localMode,true);
  }
});
test('公网配置拒绝HTTP、含凭据的地址、无效访问码及生产身份混用',()=>{
  for (const apiBase of ['http://preview.example.com','https://user:password@preview.example.com','https://preview.example.com/path?token=test'])
    assert.throws(()=>clientConfigSource({apiBase,debugToken:token,publicPreview:true}),/HTTPS|地址/);
  assert.throws(()=>clientConfigSource({apiBase:'https://preview.example.com',debugToken:'short',publicPreview:true}),/访问码/);
  assert.throws(()=>clientConfigSource({apiBase:'https://preview.example.com',debugToken:token,publicPreview:true,localMode:false}),/测试身份/);
});
