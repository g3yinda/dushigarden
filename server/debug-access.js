"use strict";
const { timingSafeEqual } = require("node:crypto");
const { networkInterfaces } = require("node:os");
function isPrivateIPv4(address) {
  if (typeof address !== "string") return false;
  const ip = address.replace(/^::ffff:/, "");
  const parts = ip.split(".");
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
function canUseLocalDebug({ mode, address, token, lanToken }) {
  if (mode !== "local") return false;
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return true;
  if (
    !isPrivateIPv4(address) ||
    !/^[a-f0-9]{64}$/.test(lanToken || "") ||
    typeof token !== "string"
  )
    return false;
  const supplied = Buffer.from(token),
    expected = Buffer.from(lanToken);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
function canUsePreviewDebug({ mode, token, previewToken }) {
  if (mode !== "preview" || !/^[a-f0-9]{64}$/.test(previewToken || "") || typeof token !== "string") return false;
  const supplied = Buffer.from(token), expected = Buffer.from(previewToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function findLanAddresses(interfaces = networkInterfaces()) {
  return [
    ...new Set(
      Object.entries(interfaces).flatMap(([name, addresses]) =>
        /^(utun|tun|tap|lo|docker|veth|awdl|llw)/i.test(name)
          ? []
          : (addresses || [])
              .filter(
                (a) =>
                  !a.internal &&
                  (a.family === "IPv4" || a.family === 4) &&
                  isPrivateIPv4(a.address),
              )
              .map((a) => a.address),
      ),
    ),
  ];
}
module.exports = { isPrivateIPv4, canUseLocalDebug, canUsePreviewDebug, findLanAddresses };
