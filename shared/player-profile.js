"use strict";
const AVATAR_COUNT = 10;
function validAvatar(value) {
  return Number.isInteger(value) && value >= 0 && value < AVATAR_COUNT;
}
function validWechatAvatar(value) {
  return typeof value === 'string' && value.length <= 2048 &&
    /^https:\/\/(?:wx|thirdwx)\.qlogo\.cn\/(?:mmopen|mmhead)\/[A-Za-z0-9_./%?=&+-]+$/.test(value);
}
module.exports = {AVATAR_COUNT, validAvatar, validWechatAvatar};
