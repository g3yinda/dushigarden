"use strict";
const crypto = require("node:crypto");
const VERSION = 1;
const identityKey = openid => "wx:" + crypto.createHash("sha256").update(openid).digest("hex");
function normalizeNickname(value, fallback = "小猫") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value))
    throw Object.assign(new Error("昵称格式不正确，请重新输入"), {code:"NICKNAME_INVALID",status:400});
  return value.trim().slice(0,12).trim() || fallback;
}
function approvedNickname(player, name) {
  return player?.nicknameReview?.version === VERSION && player.nicknameReview.name === name;
}
function reviewRecord(name, result) {
  return {version:VERSION, name, checkedAt:Date.now(), traceId:result?.traceId || ""};
}

// Runs once on production startup, before listening. Never re-publish old unchecked
// nicknames, including names baked into historical game text. Card events survive.
function migrateNicknames(service) {
  service.nicknamePolicyVersion = VERSION;
  let changed = false;
  for (const p of Object.values(service.players)) {
    if (!approvedNickname(p,p.name)) {
      if (p.name !== "小猫" || p.nicknameReview) changed = true;
      p.name = "小猫";
      delete p.nicknameReview;
    }
  }
  for (const r of Object.values(service.rooms)) {
    let repaired = false;
    for (const seat of [...r.players, ...(r.game?.players || [])]) {
      const name = service.players[seat.id]?.name || "小猫";
      if (seat.name !== name) {seat.name=name;repaired=true;}
    }
    if (r.nicknamePolicyVersion !== VERSION) {
      for (const log of r.game?.logs || []) log.text = "历史行动（昵称审核升级前）";
      r.nicknamePolicyVersion = VERSION;
      repaired = true;
    }
    if (repaired) {r.revision++;changed=true;}
  }
  if (changed) service.save();
}
module.exports={normalizeNickname,approvedNickname,reviewRecord,identityKey,migrateNicknames};
