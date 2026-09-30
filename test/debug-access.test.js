const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canUseLocalDebug,
  isPrivateIPv4,
  findLanAddresses,
} = require("../server/debug-access");
const token = "a".repeat(64);
test("默认开发访问仍只允许回环，不能凭转发头或私网地址绕过", () => {
  assert(canUseLocalDebug({ mode: "local", address: "127.0.0.1" }));
  assert(canUseLocalDebug({ mode: "local", address: "::1" }));
  assert(!canUseLocalDebug({ mode: "local", address: "192.168.1.2" }));
  assert(
    !canUseLocalDebug({
      mode: "local",
      address: "203.0.113.2",
      token,
      lanToken: token,
    }),
  );
});
test("同Wi-Fi开发访问必须同时满足私网源地址和每次启动访问码", () => {
  for (const address of [
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.2",
    "::ffff:192.168.0.2",
  ]) {
    assert(
      canUseLocalDebug({ mode: "local", address, token, lanToken: token }),
    );
    assert(
      !canUseLocalDebug({
        mode: "local",
        address,
        token: "wrong",
        lanToken: token,
      }),
    );
    assert(!canUseLocalDebug({ mode: "local", address, lanToken: token }));
  }
  for (const address of [
    "172.15.0.1",
    "172.32.0.1",
    "198.18.0.1",
    "8.8.8.8",
    "fe80::1",
  ])
    assert(!isPrivateIPv4(address));
});
test("正式模式即使访问码和源地址正确仍不允许开发访问", () => {
  for (const address of ["127.0.0.1", "192.168.0.2"])
    assert(
      !canUseLocalDebug({ mode: "wechat", address, token, lanToken: token }),
    );
});
test("查找局域网地址避开回环和VPN，支持多个物理网卡与无Wi-Fi", () => {
  assert.deepEqual(
    findLanAddresses({
      lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
      utun0: [{ family: "IPv4", internal: false, address: "10.0.0.1" }],
      en1: [{ family: "IPv4", internal: false, address: "192.168.0.107" }],
      en0: [{ family: 4, internal: false, address: "10.1.1.2" }],
    }),
    ["192.168.0.107", "10.1.1.2"],
  );
  assert.deepEqual(findLanAddresses({}), []);
});
