"use strict";

function applyData(data, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
    if (parts.some(p => ["__proto__", "prototype", "constructor"].includes(p))) continue;
    let target = data;
    for (let i = 0; i < parts.length - 1; i++) {
      target[parts[i]] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }
}

function createGameRuntime({ wx, definition, Renderer, schedule, cancel }) {
  schedule ||= callback => typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback) : setTimeout(callback, 33);
  cancel ||= id => typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame(id) : clearTimeout(id);
  const canvas = wx.createCanvas();
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  let visible = true, destroyed = false, frame = null, ui, inputField = null;
  const subscriptions = [];
  function windowInfo() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect?.();
    return { ...info, menu };
  }
  function resize() {
    const info = windowInfo();
    canvas.width = Math.round(info.windowWidth * (info.pixelRatio || 1));
    canvas.height = Math.round(info.windowHeight * (info.pixelRatio || 1));
    ui?.resize(info);
    invalidate();
  }
  function invalidate() {
    if (destroyed || !visible || frame !== null || !ui) return;
    frame = schedule(() => {
      frame = null;
      if (!visible || destroyed) return;
      ui.render(Date.now());
      if (ui.needsFrame()) invalidate();
    });
  }
  page.setData = patch => { applyData(page.data, patch); invalidate(); };
  function keyboardValue(event) {
    if (!inputField) return;
    let value = String(event.value || "");
    if (inputField === "code") value = value.replace(/\D/g, "").slice(0, 6);
    else value = value.slice(0, 12);
    page.input({currentTarget:{dataset:{field:inputField}}, detail:{value}});
  }
  function openInput(field) {
    if (!["name", "code"].includes(field) || destroyed) return;
    inputField = field;
    wx.showKeyboard({defaultValue:String(page.data[field] || ""), maxLength:field === "code" ? 6 : 12,
      multiple:false, confirmHold:false, confirmType:"done",
      fail:() => { inputField = null; page.notice("键盘暂时无法打开，请重试"); }});
  }
  function share() {
    return {title:page.data.room ? "来玩炸弹猫，房间号 " + page.data.room.code : "朋友局 · 炸弹猫",
      query:page.data.room ? "room=" + encodeURIComponent(page.data.room.code) : "",
      // Never use the default game screenshot: it could expose private cards.
      imageUrl:"assets/share.png"};
  }
  function subscribe(name, callback) {
    if (typeof wx["on" + name] !== "function") return;
    wx["on" + name](callback);
    subscriptions.push([name, callback]);
  }
  function hide() {
    if (!visible || destroyed) return;
    visible = false;
    page.onHide();
    ui.touchCancel?.();
    if (frame !== null) { cancel(frame); frame = null; }
    inputField = null;
  }
  function show(options = {}) {
    if (destroyed) return;
    const room = options.query?.room;
    if (/^\d{6}$/.test(room || "") && !page.data.room)
      page.updateData({modal:"join", code:room});
    if (visible) return;
    visible = true;
    page.onShow();
    resize();
  }
  resize();
  ui = new Renderer({canvas, wx, page, info:windowInfo(), onInput:openInput, onInvalidate:invalidate, share});
  subscribe("Show", show);
  subscribe("Hide", hide);
  subscribe("WindowResize", resize);
  for (const [name, method] of [["TouchStart","touchStart"],["TouchMove","touchMove"],["TouchEnd","touchEnd"]])
    subscribe(name, event => { if (visible && !destroyed) { ui[method](event); invalidate(); } });
  subscribe("TouchCancel", () => { ui.touchCancel?.(); invalidate(); });
  subscribe("KeyboardInput", keyboardValue);
  subscribe("KeyboardConfirm", event => {keyboardValue(event); inputField=null;wx.hideKeyboard?.();});
  subscribe("KeyboardComplete", event => {keyboardValue(event); inputField=null;});
  subscribe("ShareAppMessage", share);
  wx.showShareMenu?.({withShareTicket:true});
  const launch = wx.getLaunchOptionsSync?.() || {};
  page.onLoad({room: /^\d{6}$/.test(launch.query?.room || "") ? launch.query.room : undefined});
  page.onShow();
  invalidate();
  return {page, ui, canvas, openInput, share, invalidate,
    destroy() {
      if (destroyed) return;
      hide();
      destroyed=true;
      for (const [name,callback] of subscriptions) wx["off"+name]?.(callback);
      page.onUnload();
      ui.destroy();
    }};
}
module.exports = {createGameRuntime, applyData};
