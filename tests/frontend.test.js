const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../miniprogram/lib/controller");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const room = {
  me: "a",
  hostId: "a",
  status: "playing",
  players: [
    { id: "a", name: "甲" },
    { id: "b", name: "乙" },
  ],
  game: {
    id: "g",
    phase: "action",
    current: "a",
    remaining: 1,
    players: [
      { id: "a", alive: true, count: 3 },
      { id: "b", alive: true, count: 3 },
    ],
    hand: [
      { id: "1", type: "cat1" },
      { id: "2", type: "cat1" },
      { id: "3", type: "defuse" },
    ],
    deckCount: 3,
  },
};
test("single cat cannot play; same-name pairs require target", () => {
  assert.equal(ui.selection(room, ["1"]).valid, false);
  assert.equal(ui.selection(room, ["1", "2"]).needsTarget, true);
  assert.equal(ui.selection(room, ["1", "3"]).valid, false);
});
test("out of turn cannot draw or play", () => {
  let r = structuredClone(room);
  r.game.current = "b";
  assert.equal(ui.derive(r, []).canDraw, false);
  assert.equal(ui.selection(r, ["1", "2"]).valid, false);
});
test("spectators cannot nope", () => {
  let r = structuredClone(room);
  r.game.phase = "nope";
  r.game.hand = [{ id: "n", type: "nope" }];
  r.game.players[0].alive = false;
  assert.equal(ui.derive(r, []).canNope, false);
});
test("selection drops stale card ids and insert exposes every position", () => {
  assert.equal(ui.selection(room, ["gone"]).valid, false);
  assert.deepEqual(
    ui
      .derive({ ...room, game: { ...room.game, phase: "insert" } }, [])
      .positions.map((x) => x.value),
    [1, 2, 3, 4],
  );
});
test("favor can only be given by its target", () => {
  let r = structuredClone(room);
  r.game.phase = "favor";
  r.game.pending = { target: "b" };
  assert.equal(ui.derive(r, ["1"]).canGive, false);
  r.game.pending.target = "a";
  assert.equal(ui.derive(r, ["1"]).canGive, true);
});
test("全部 13 种牌名必须与规则目录一致，并各自有明确素材", () => {
  const { CARDS } = require("../shared/cards");
  for (const [type, c] of Object.entries(CARDS)) {
    const front = ui.card({ id: "x", type });
    assert.equal(front.name, c.name);
    assert(front.source);
    assert(front.short);
  }
});
test("指向零手牌对手的索要/对子不能提交", () => {
  const r = structuredClone(room);
  r.game.players[1].count = 0;
  r.game.hand = [
    { id: "f", type: "favor" },
    { id: "1", type: "cat1" },
    { id: "2", type: "cat1" },
  ];
  assert.equal(ui.selection(r, ["f"]).valid, false);
  assert.equal(ui.selection(r, ["1", "2"]).valid, false);
});
test("陈旧选中牌不能交牌，插回索引恢复到合法值", () => {
  const r = structuredClone(room);
  r.game.phase = "favor";
  r.game.pending = { target: "a" };
  assert.equal(ui.derive(r, ["stale"]).canGive, false);
});
test("动效使用接收者可见状态，私密新牌只来自本人手牌", () => {
  const before = structuredClone(room);
  const after = structuredClone(room);
  after.game.hand.push({ id: "new", type: "skip" });
  after.game.players[0].count++;
  const effect = ui.motion(before, after);
  assert.equal(effect.kind, "draw");
  assert.equal(effect.card.type, "skip");
  const publicOnly = structuredClone(room);
  publicOnly.game.players[1].count++;
  assert.equal(ui.motion(before, publicOnly), null);
});
test("回合切换让出牌确认失效，否定层变化也必须重确认", () => {
  const after = structuredClone(room);
  after.game.current = "b";
  assert(ui.contextChanged(room, after));
  const a = structuredClone(room);
  a.game.phase = "nope";
  a.game.pending = { nopeCount: 0 };
  const b = structuredClone(a);
  b.game.pending.nopeCount = 1;
  assert(ui.contextChanged(a, b));
});

for (const [client, controller] of [
  ["native", ui],
  ["browser", require("../web/controller")],
]) {
  test(`${client}: waiting room preserves public Bot identity`, () => {
    const r = structuredClone(room);
    r.status = "waiting";
    r.game = null;
    r.players[1].isBot = true;
    r.players[1].ready = true;
    const v = controller.derive(r, [], true);
    assert.equal(v.players[1].isBot, true);
    assert.equal(v.players[0].isBot, false);
    assert.equal(v.ready, false);
    assert.equal(v.canStart, false);
  });
  test(`${client}: game projection falls back to room Bot identity`, () => {
    const r = structuredClone(room);
    r.players[1].isBot = true;
    const v = controller.derive(r, ["1", "2"]);
    assert.equal(v.players[1].isBot, true);
    assert.equal(v.targets[0].isBot, true);
    assert.equal(v.selection.valid, true);
    r.game.players[1].isBot = false;
    assert.equal(controller.derive(r, []).players[1].isBot, false);
  });
  test(`${client}: Bot capacity is limited to local waiting room hosts`, () => {
    const r = structuredClone(room);
    r.status = "waiting";
    r.game = null;
    assert.deepEqual(controller.derive(r, [], true).botCounts, [1, 2, 3, 4]);
    assert.equal(controller.derive(r, [], true).canAddBots, true);
    assert.equal(controller.derive(r, [], false).canAddBots, false);
    r.me = "b";
    assert.equal(controller.derive(r, [], true).canAddBots, false);
    r.me = "a";
    r.players.push({ id: "c" }, { id: "d" }, { id: "e" }, { id: "f" });
    assert.equal(controller.derive(r, [], true).canAddBots, false);
    r.players.pop();
    r.status = "playing";
    assert.equal(controller.derive(r, [], true).canAddBots, false);
  });
  test(`${client}: Bot and human targets follow identical effect eligibility`, () => {
    const r = structuredClone(room);
    r.players[1].isBot = true;
    r.game.hand = [{ id: "f", type: "favor" }, ...r.game.hand];
    for (const cards of [["f"], ["1", "2"]]) {
      const bot = controller.derive(r, cards);
      const humanRoom = structuredClone(r);
      delete humanRoom.players[1].isBot;
      const human = controller.derive(humanRoom, cards);
      assert.deepEqual(
        bot.targets.map((p) => p.id),
        human.targets.map((p) => p.id),
      );
      assert.deepEqual(bot.selection, human.selection);
      r.game.players[1].count = 0;
      assert.equal(controller.derive(r, cards).targets.length, 0);
      assert.equal(controller.selection(r, cards).valid, false);
      r.game.players[1].count = 3;
    }
  });
}

function waitingRoom() {
  const r = structuredClone(room);
  r.game = null;
  r.status = "waiting";
  r.code = "123456";
  r.revision = 7;
  r.serverNow = Date.now();
  return r;
}
function nativeHarness(schedule = () => 1, configOverrides = {}, wxApi = {}) {
  let page;
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../miniprogram/pages/home/home.js"),
      "utf8",
    ),
    {
      require: (name) =>
        name.includes("controller")
          ? {
              ...ui,
              createMotionPlayer: (options) =>
                ui.createMotionPlayer({ ...options, schedule }),
            }
          : { localMode: true, ...configOverrides },
      Page: (definition) => {
        page = definition;
      },
      wx: wxApi,
      setTimeout: schedule,
      clearTimeout() {},
    },
  );
  page.setData = (update) => Object.assign(page.data, update);
  page.accept(waitingRoom());
  page.notices = [];
  page.notice = (message) => page.notices.push(message);
  return page;
}
test("native 创建房间先选择不限时模式，最终提交房间选项", async () => {
  const page = nativeHarness();
  page.data.room = null;
  const calls = [];
  page.session = async () => {};
  page.request = async (url, body) => {
    calls.push({ url, body });
    return waitingRoom();
  };
  page.poll = () => {};
  await page.action({ currentTarget: { dataset: { action: "create" } } });
  assert.equal(page.data.modal, "create");
  assert.equal(calls.length, 0);
  page.roomSetting({ detail: { value: true } });
  await page.action({
    currentTarget: { dataset: { action: "create-submit" } },
  });
  assert.equal(calls[0].url, "/rooms");
  assert.equal(calls[0].body.noTurnTimer, true);
});
test("native 建房默认10秒，可选择15/5秒并提交，重开建房面板复位", async () => {
  const page = nativeHarness();
  page.data.room = null;
  page.session = async () => {};
  page.poll = () => {};
  const calls = [];
  page.request = async (_, body) => { calls.push(body); return waitingRoom(); };
  await page.action({ currentTarget: { dataset: { action: "create" } } });
  assert.equal(page.data.nopeSeconds, 10);
  for (const seconds of [15, 5]) {
    await page.action({ currentTarget: { dataset: { action: "nope-time", seconds } } });
    await page.action({ currentTarget: { dataset: { action: "create-submit" } } });
    assert.equal(calls.at(-1).nopeSeconds, seconds);
  }
  await page.action({ currentTarget: { dataset: { action: "create" } } });
  assert.equal(page.data.nopeSeconds, 10);
});
test("native 关闭必须由房主进入确认，收到关闭后停止同步并清理回大厅", async () => {
  const page = nativeHarness();
  page.accept({ ...structuredClone(room), code: "123456" });
  page.data.selected = ["1", "2"];
  page.data.canResume = true;
  await page.action({ currentTarget: { dataset: { action: "close-room" } } });
  assert.equal(page.data.modal, "close-room");
  const nonHost = { ...structuredClone(room), code: "123456", hostId: "b" };
  page.accept(nonHost);
  assert.equal(page.data.modal, "");
  await page.action({ currentTarget: { dataset: { action: "close-room" } } });
  assert.equal(page.data.modal, "");
  const epoch = page.epoch || 0;
  page.accept({ code: "123456", status: "closed", revision: 99, players: [], game: null });
  assert.equal(page.data.room, null);
  assert.equal(page.data.canResume, false);
  assert.equal(page.data.selected.length, 0);
  assert((page.epoch || 0) > epoch);
  assert.match(page.notices.at(-1), /房主.*关闭/);
});
test("native 无动效的新状态同步不会提前清除正在展示的牌", () => {
  const page = nativeHarness();
  page.data.room = structuredClone(room);
  const r = structuredClone(room);
  r.game.hand.push({ id: "new", type: "skip" });
  page.accept(r);
  assert.equal(page.data.motion.card.type, "skip");
  page.accept({ ...r, revision: 12 });
  assert.equal(page.data.motion.card.type, "skip");
});
test("native 连续同类出牌更换动画节点，普通同步不更换节点", () => {
  const timers = [];
  const page = nativeHarness((fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  });
  page.data.room = structuredClone(room);
  const r = structuredClone(room);
  r.game.logs = [1, 2].map((id) => ({
    id,
    text: "甲出牌",
    cardEvent: {
      kind: "play",
      actor: "a",
      cards: [{ id: "played" + id, type: "shuffle" }],
    },
  }));
  page.accept(r);
  const first = page.data.motionItems[0];
  assert.equal(first.kind, "play");
  page.accept({ ...r, revision: 12 });
  assert.equal(page.data.motionItems[0].renderId, first.renderId);
  assert.equal(timers[0].ms, 5000);
  timers[0].fn();
  const second = page.data.motionItems[0];
  assert.equal(second.kind, "play");
  assert.notEqual(second.renderId, first.renderId);
  assert.equal(second.card.id, "played2");
  timers[1].fn();
  assert.equal(page.data.motionItems.length, 0);
});
test("native 房间失效回大厅时清除旧局动画队列", async () => {
  const page = nativeHarness();
  page.visible = true;
  page.data.room = structuredClone(room);
  const r = structuredClone(room);
  r.game.hand.push({ id: "new", type: "skip" });
  page.accept(r);
  assert(page.data.motion);
  page.data.selected = ["new"];
  page.data.canResume = true;
  page.data.handExpanded = true;
  page.request = async () => {
    throw Object.assign(Error("房间已关闭"), { status: 410 });
  };
  await page.poll();
  assert.equal(page.data.room, null);
  assert.equal(page.data.motion, null);
  assert.equal(page.data.motionItems.length, 0);
  assert.equal(page.data.selected.length, 0);
  assert.equal(page.data.canResume, false);
  assert.equal(page.data.handExpanded, false);
});
async function browserHarness(mode) {
  const handlers = {},
    nodes = { "#app": { innerHTML: "" }, "#toast": { style: {} } };
  const requests = [];
  const context = vm.createContext({
    BoomUI: require("../web/controller"),
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: () => null },
    document: {
      body: { classList: { toggle() {} } },
      querySelector: (selector) => nodes[selector] || null,
      addEventListener: (event, handler) => {
        handlers[event] = handler;
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, mode }) };
    },
    location: { search: "", origin: "http://localhost" },
    URLSearchParams,
    setInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    crypto: require("node:crypto"),
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return {
    context,
    requests,
    nodes,
    state: vm.runInContext("S", context),
    click: (action, data = {}) =>
      handlers.click({ target: { closest: () => ({ dataset: { action, ...data } }) } }),
  };
}
test("native 手牌默认收起，切换保留多选，同步保持而新局复位", async () => {
  const page = nativeHarness();
  page.accept(structuredClone(room));
  assert.equal(page.data.handExpanded, false);
  page.data.selected = ["1", "2"];
  await page.action({ currentTarget: { dataset: { action: "hand-toggle" } } });
  assert.equal(page.data.handExpanded, true);
  assert.deepEqual(page.data.selected, ["1", "2"]);
  page.accept({ ...structuredClone(room), revision: 11 });
  assert.equal(page.data.handExpanded, true);
  await page.action({ currentTarget: { dataset: { action: "hand-toggle" } } });
  assert.equal(page.data.handExpanded, false);
  assert.deepEqual(Array.from(page.data.selected), ["1", "2"]);
  await page.action({ currentTarget: { dataset: { action: "hand-toggle" } } });
  const next = structuredClone(room);
  next.game.id = "next-game";
  page.accept(next);
  assert.equal(page.data.handExpanded, false);
});
test("browser 手牌默认收起，切换保留多选，同步保持而新局复位", async () => {
  const h = await browserHarness("local");
  h.context.updatedRoom = { ...structuredClone(room), code: "123456", revision: 1 };
  vm.runInContext("accept(updatedRoom)", h.context);
  assert.equal(h.state.handExpanded, false);
  h.state.selected = ["1", "2"];
  await h.click("hand-toggle");
  assert.equal(h.state.handExpanded, true);
  assert.deepEqual(h.state.selected, ["1", "2"]);
  assert.match(h.nodes["#app"].innerHTML, /收起手牌/);
  vm.runInContext("accept({...updatedRoom, revision: 11})", h.context);
  assert.equal(h.state.handExpanded, true);
  await h.click("hand-toggle");
  assert.equal(h.state.handExpanded, false);
  assert.deepEqual(Array.from(h.state.selected), ["1", "2"]);
  assert.match(h.nodes["#app"].innerHTML, /展开手牌/);
  await h.click("hand-toggle");
  h.context.updatedRoom = structuredClone(h.context.updatedRoom);
  h.context.updatedRoom.game.id = "next-game";
  h.context.updatedRoom.revision = 12;
  vm.runInContext("accept(updatedRoom)", h.context);
  assert.equal(h.state.handExpanded, false);
});
test("browser 创建房间先选不限时再提交，默认计时不变", async () => {
  const h = await browserHarness("local");
  h.state.token = "test";
  await h.click("create");
  assert.equal(h.state.modal, "create");
  assert.equal(h.state.noTurnTimer, false);
  assert(!h.requests.some((r) => r.url === "/api/rooms"));
  h.state.noTurnTimer = true;
  h.context.fetch = async (url, options) => {
    h.requests.push({ url, options });
    return { ok: true, json: async () => waitingRoom() };
  };
  vm.runInContext("poll = () => {}", h.context);
  await h.click("create-submit");
  const call = h.requests.find((r) => r.url === "/api/rooms");
  assert.equal(JSON.parse(call.options.body).noTurnTimer, true);
});
test("browser 建房默认10秒，三档选择提交且普通成员看不到关闭入口", async () => {
  const h = await browserHarness("local");
  await h.click("create");
  assert.equal(h.state.nopeSeconds, 10);
  for (const seconds of [15, 10, 5]) {
    await h.click("nope-time", { seconds });
    assert.equal(h.state.nopeSeconds, seconds);
    h.state.token = "test";
    h.context.fetch = async (url, options) => { h.requests.push({url,options}); return {ok:true,json:async()=>waitingRoom()}; };
    vm.runInContext("poll = () => {}", h.context);
    await h.click("create-submit");
    const call = h.requests.filter(r=>r.url === "/api/rooms").at(-1);
    assert.equal(JSON.parse(call.options.body).nopeSeconds, seconds);
  }
  h.state.room = { ...structuredClone(room), hostId: "b" };
  await h.click("leave");
  assert(!h.nodes["#app"].innerHTML.includes('data-action="close-room"'));
  await h.click("close-room");
  assert.equal(h.state.modal, "leave");
});
test("browser 房主关闭需确认，角色变化取消确认；收到关闭返回大厅无恢复入口", async () => {
  const h = await browserHarness("local");
  h.state.room = { ...structuredClone(room), code: "123456" };
  await h.click("leave");
  assert.match(h.nodes["#app"].innerHTML, /关闭整个房间/);
  await h.click("close-room");
  assert.equal(h.state.modal, "close-room");
  h.context.updatedRoom = {...structuredClone(h.state.room), hostId:"b"};
  vm.runInContext("accept(updatedRoom)", h.context);
  assert.equal(h.state.modal, null);
  h.state.resume = true;
  h.state.selected = ["1"];
  const epoch = h.state.poll;
  h.context.updatedRoom = {code:"123456",revision:99,status:"closed",players:[],game:null};
  vm.runInContext("accept(updatedRoom)", h.context);
  assert.equal(h.state.room, null);
  assert.equal(h.state.resume, false);
  assert.equal(h.state.selected.length, 0);
  assert(h.state.poll > epoch);
  assert.match(h.nodes["#toast"].textContent, /房主.*关闭/);
});
test("browser 房间失效回大厅时清除旧局动画队列", async () => {
  const h = await browserHarness("local");
  h.state.room = structuredClone(room);
  const r = structuredClone(room);
  r.game.hand.push({ id: "new", type: "skip" });
  h.context.updatedRoom = r;
  vm.runInContext("accept(updatedRoom)", h.context);
  assert(h.state.motion);
  h.state.selected = ["new"];
  h.state.resume = true;
  h.state.handExpanded = true;
  h.context.fetch = async () => ({
    ok: false,
    status: 410,
    json: async () => ({ message: "房间已关闭" }),
  });
  await vm.runInContext("poll()", h.context);
  assert.equal(h.state.room, null);
  assert.equal(h.state.motion, null);
  assert.equal(h.state.selected.length, 0);
  assert.equal(h.state.resume, false);
  assert.equal(h.state.handExpanded, false);
});
test("native Bot form defaults off and submits one revision-guarded request under busy lock", async () => {
  const page = nativeHarness();
  await page.action({ currentTarget: { dataset: { action: "bots" } } });
  assert.equal(page.data.modal, "bots");
  assert.equal(page.data.botCount, 1);
  assert.equal(page.data.respondNope, false);
  page.chooseBotCount({ detail: { value: "2" } });
  page.botSetting({ detail: { value: true } });
  const calls = [];
  let complete;
  page.request = (url, body) => {
    calls.push({ url, body });
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const action = { currentTarget: { dataset: { action: "bots-submit" } } };
  const first = page.action(action);
  await page.action(action);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/rooms/123456/bots");
  assert.equal(calls[0].body.count, 3);
  assert.equal(calls[0].body.respondNope, true);
  assert.equal(calls[0].body.revision, 7);
  assert(calls[0].body.commandId);
  complete({ ...waitingRoom(), revision: 8 });
  await first;
  assert.equal(page.data.modal, "");
  assert.equal(page.data.busy, false);
  assert.equal(page.data.room.revision, 8);
});
test("native Bot conflict refreshes room and explains stale capacity", async () => {
  const page = nativeHarness();
  await page.action({ currentTarget: { dataset: { action: "bots" } } });
  page.request = async () => {
    throw Object.assign(Error("changed"), { status: 409 });
  };
  let refreshed = false;
  page.refresh = async () => {
    refreshed = true;
  };
  await page.action({ currentTarget: { dataset: { action: "bots-submit" } } });
  assert.equal(refreshed, true);
  assert.match(page.notices.at(-1), /房间.*变化/);
  assert.equal(page.data.busy, false);
});
test("browser only exposes Bot entry when health reports local mode", async () => {
  for (const mode of ["local", "wechat"]) {
    const h = await browserHarness(mode);
    assert.equal(h.requests[0]?.url, "/api/health");
    assert.equal(h.state.localMode, mode === "local");
    h.state.room = waitingRoom();
    vm.runInContext("render()", h.context);
    assert.equal(
      h.nodes["#app"].innerHTML.includes("添加验证 Bot"),
      mode === "local",
    );
  }
});
test("browser Bot form sends selected policy once and handles conflict", async () => {
  const h = await browserHarness("local");
  h.state.room = waitingRoom();
  await h.click("bots");
  assert.equal(h.state.botCount, 1);
  assert.equal(h.state.respondNope, false);
  h.state.botCount = 2;
  let complete;
  h.context.fetch = (url, options) => {
    h.requests.push({ url, options });
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const first = h.click("bots-submit");
  await h.click("bots-submit");
  const calls = h.requests.filter((request) => request.url.endsWith("/bots"));
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.count, 2);
  assert.equal(body.respondNope, false);
  assert.equal(body.revision, 7);
  assert(body.commandId);
  complete({ ok: true, json: async () => ({ ...waitingRoom(), revision: 8 }) });
  await first;
  assert.equal(h.state.modal, null);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.room.revision, 8);
  await h.click("bots");
  h.context.fetch = async (url) =>
    url.endsWith("/bots")
      ? { ok: false, status: 409, json: async () => ({ message: "changed" }) }
      : { ok: true, json: async () => ({ ...waitingRoom(), revision: 9 }) };
  await h.click("bots-submit");
  assert.equal(h.state.room.revision, 9);
  assert.match(h.nodes["#toast"].textContent, /房间.*变化/);
  assert.equal(h.state.busy, false);
});
test("Bot forms reset a count that no longer fits after room refresh", async () => {
  const updated = waitingRoom();
  updated.revision++;
  updated.players.push({ id: "c" }, { id: "d" });
  const page = nativeHarness();
  await page.action({ currentTarget: { dataset: { action: "bots" } } });
  page.chooseBotCount({ detail: { value: "2" } });
  page.accept(updated);
  assert.equal(page.data.botCount, 1);
  assert.equal(page.data.botCountIndex, 0);
  const h = await browserHarness("local");
  h.state.room = waitingRoom();
  await h.click("bots");
  h.state.botCount = 3;
  h.context.updatedRoom = updated;
  vm.runInContext("accept(updatedRoom)", h.context);
  assert.equal(h.state.botCount, 1);
});
test("native invalidates old poll before leaving and ignores its membership error", async () => {
  const page = nativeHarness();
  page.visible = true;
  let rejectPoll;
  let aborted = false;
  let oldEpoch;
  let invalidBeforeLeave = false;
  let abortedBeforeLeave = false;
  page.pollRequest = {
    abort: () => {
      aborted = true;
    },
  };
  page.request = (url) => {
    if (url.includes("?after=")) {
      oldEpoch = page.epoch;
      return new Promise((resolve, reject) => {
        rejectPoll = reject;
      });
    }
    invalidBeforeLeave = page.epoch > oldEpoch;
    abortedBeforeLeave = aborted;
    rejectPoll(Object.assign(Error("你不在这个房间中"), { status: 403 }));
    return Promise.resolve(null);
  };
  const oldPoll = page.poll();
  await page.command("leave");
  await oldPoll;
  assert.equal(invalidBeforeLeave, true);
  assert.equal(abortedBeforeLeave, true);
  assert.deepEqual(page.notices, []);
  assert.equal(page.data.room, null);
});
test("native failed leave resumes polling its existing room", async () => {
  const page = nativeHarness();
  page.visible = true;
  page.epoch = 10;
  let restarts = 0;
  page.poll = () => {
    restarts++;
  };
  page.request = async () => {
    assert(
      page.epoch > 10,
      "old poll must be invalid before leave HTTP starts",
    );
    throw Error("离房失败");
  };
  await page.command("leave");
  assert.equal(page.data.room.code, "123456");
  assert.equal(page.data.busy, false);
  assert.equal(restarts, 1);
  assert.equal(page.notices.at(-1), "离房失败");
});
test("browser invalidates old poll before leaving and ignores its membership error", async () => {
  const h = await browserHarness("local");
  h.state.room = waitingRoom();
  let rejectPoll;
  let oldEpoch;
  let invalidBeforeLeave = false;
  h.context.fetch = (url) => {
    if (url.includes("?after=")) {
      oldEpoch = h.state.poll;
      return new Promise((resolve, reject) => {
        rejectPoll = reject;
      });
    }
    invalidBeforeLeave = h.state.poll > oldEpoch;
    rejectPoll(Object.assign(Error("你不在这个房间中"), { status: 403 }));
    return Promise.resolve({ ok: true, json: async () => null });
  };
  const oldPoll = vm.runInContext("poll()", h.context);
  await h.click("leave-submit");
  await oldPoll;
  assert.equal(invalidBeforeLeave, true);
  assert.equal(h.nodes["#toast"].textContent, undefined);
  assert.equal(h.state.room, null);
});
test("browser failed leave resumes polling its existing room", async () => {
  const h = await browserHarness("local");
  h.state.room = waitingRoom();
  h.state.poll = 10;
  let restarts = 0;
  h.context.restartPoll = () => {
    restarts++;
  };
  vm.runInContext("poll = restartPoll", h.context);
  h.context.fetch = async () => {
    assert(
      h.state.poll > 10,
      "old poll must be invalid before leave HTTP starts",
    );
    throw Error("离房失败");
  };
  await h.click("leave-submit");
  assert.equal(h.state.room.code, "123456");
  assert.equal(h.state.busy, false);
  assert.equal(restarts, 1);
  assert.equal(h.nodes["#toast"].textContent, "离房失败");
});
test("native 真机请求电脑LAN地址并携带本地调试访问码", async () => {
  let captured;
  const page = nativeHarness(
    () => 1,
    { apiBase: "http://192.168.0.107:8787", debugToken: "debug-test" },
    {
      request: (options) => {
        captured = options;
        options.success({ statusCode: 200, data: { ok: true } });
        return {};
      },
    },
  );
  await page.request("/rooms", { noTurnTimer: true });
  assert.equal(captured.url, "http://192.168.0.107:8787/api/rooms");
  assert.equal(captured.header["X-Boomcat-Debug"], "debug-test");
});

function nopeRoom(layer = 0, hand = [{ id: "n1", type: "nope" }, { id: "n2", type: "nope" }]) {
  const r = structuredClone(room);
  r.code = "123456";
  r.revision = 20 + layer;
  r.serverNow = Date.now();
  r.options = { nopeSeconds: 10 };
  r.game.phase = "nope";
  r.game.current = "b";
  r.game.deadline = r.serverNow + 10000;
  r.game.hand = hand;
  r.game.pending = { actor: "b", type: "attack", count: 1, nopeCount: layer };
  return r;
}
test("否定响应提示只看本人牌；同层key不变，反否定文案/新层key和截止正确", () => {
  const r = nopeRoom();
  const p = ui.nopeResponse(r, r.serverNow);
  assert.equal(p.canNope, true);
  assert.equal(p.remaining, 10);
  assert.equal(p.actorName, "乙");
  assert.match(p.resultText, /取消.*攻击/);
  assert.equal(ui.nopeResponse({ ...r, revision: 20 }, r.serverNow).key, p.key);
  r.game.pending.nopeCount = 1;
  assert.notEqual(ui.nopeResponse(r, r.serverNow).key, p.key);
  assert.match(ui.nopeResponse(r, r.serverNow).resultText, /恢复.*攻击/);
  assert.equal(ui.nopeResponse(r, r.game.deadline).canNope, false);
  r.game.players[0].alive = false;
  assert.equal(ui.nopeResponse(r, r.serverNow).canNope, false);
  r.game.players[0].alive = true;
  r.game.hand = [{ id: "x", type: "defuse" }];
  assert.equal(ui.nopeResponse(r, r.serverNow).canNope, false);
  r.game.phase = "defuse";
  assert.equal(ui.nopeResponse(r, r.serverNow), null);
});
test("native 固定提示不弹窗；不出提交服务器、停止本人计时且不可改出", async () => {
  const page = nativeHarness(), r = nopeRoom();
  page.accept(r);
  assert.equal(page.data.modal, "");
  const key = page.data.nopeInfo.key;
  let calls = [];
  page.command = async (type, data) => {
    calls.push({type,data});
    const next = structuredClone(r);
    next.revision++;
    next.game.pending.responses = {a:"passed",b:"waiting"};
    page.accept(next);
  };
  await page.action({currentTarget:{dataset:{action:"nope-pass",window:key}}});
  assert.equal(calls[0].type,"passNope");
  assert.equal(calls[0].data.nopeCount,0);
  assert.equal(page.data.nopeInfo.canNope,false);
  assert.equal(page.data.nopeInfo.remaining,0);
  await page.action({currentTarget:{dataset:{action:"nope-response",window:key}}});
  assert.equal(calls.length,1);
  const next = nopeRoom(1);
  next.game.pending.responses = {a:"waiting",b:"played"};
  page.accept(next);
  assert.equal(page.data.nopeInfo.canNope,true);
  assert.equal(page.data.modal,"");
});
test("native 失败不锁定；截止、无牌和旁观不能打出，旧层点击被拒绝", async () => {
  const page = nativeHarness();
  page.accept(nopeRoom());
  page.request = async () => {throw Error("暂时断网");};
  const key = page.data.nopeInfo.key;
  await page.action({currentTarget:{dataset:{action:"nope-pass",window:key}}});
  assert.equal(page.data.nopeInfo.canPass,true);
  assert.equal(page.data.busy,false);
  let calls = 0; page.command = async () => calls++;
  page.accept(nopeRoom(1,[]));
  assert.equal(page.data.nopeInfo.canPass,true);
  await page.action({currentTarget:{dataset:{action:"nope-pass",window:key}}});
  assert.equal(calls,0);
  page.offset=20000; page.tick();
  assert.equal(page.data.nopeInfo.canPass,false);
  const spectator=nopeRoom(2); spectator.game.players[0].alive=false; page.accept(spectator);
  assert.equal(page.data.nopeInfo.canPass,false);
  page.accept({code:"123456",revision:99,status:"closed",players:[],game:null});
  assert.equal(page.data.nopeInfo,null);
});
async function receiveNope(h,r) {
  h.context.updatedRoom = r; vm.runInContext("accept(updatedRoom)",h.context);
}
test("browser 原页面固定是否选择否定；不出发送请求、成功后不可改出", async () => {
  const h = await browserHarness("local"), r=nopeRoom();
  await receiveNope(h,r);
  assert.equal(h.state.modal,null);
  assert.match(h.nodes["#app"].innerHTML,/是否选择否定/);
  assert.doesNotMatch(h.nodes["#app"].innerHTML,/role="dialog"/);
  const key=h.state.nopeInfo.key;
  let submitted;
  h.context.fetch=async (url,options)=>{
    submitted=JSON.parse(options.body);
    const next=structuredClone(r); next.revision++; next.game.pending.responses={a:"passed",b:"waiting"};
    return {ok:true,json:async()=>next};
  };
  await h.click("nope-pass",{window:key});
  assert.equal(submitted.type,"passNope");
  assert.equal(h.state.nopeInfo.remaining,0);
  assert.equal(h.state.nopeInfo.canNope,false);
  assert.match(h.nodes["#app"].innerHTML,/已选择不出/);
  assert.match(h.nodes["#app"].innerHTML,/data-action="nope-response" disabled/);
  submitted=null;
  await h.click("nope-response",{window:key});
  assert.equal(submitted,null);
  await receiveNope(h,nopeRoom(1));
  assert.equal(h.state.modal,null);
  assert.match(h.nodes["#app"].innerHTML,/打出反否定/);
});
test("browser 失败可重试，无牌可确认不出，旁观与截止禁用", async () => {
  const h=await browserHarness("local");
  await receiveNope(h,nopeRoom());
  const key=h.state.nopeInfo.key;
  h.context.fetch=async ()=>{throw Error("暂时断网");};
  await h.click("nope-pass",{window:key});
  assert.equal(h.state.nopeInfo.canPass,true);
  assert.equal(h.state.busy,false);
  await receiveNope(h,nopeRoom(1,[]));
  assert.equal(h.state.nopeInfo.canNope,false);
  assert.equal(h.state.nopeInfo.canPass,true);
  const spectator=nopeRoom(2); spectator.game.players[0].alive=false;
  await receiveNope(h,spectator); assert.equal(h.state.nopeInfo.canPass,false);
  await receiveNope(h,nopeRoom(3));
  h.state.clockOffset=20000; vm.runInContext("countdown()",h.context);
  assert.equal(h.state.nopeInfo.canPass,false);
});
test("browser 最后3秒文字颜色突出，截止后禁用两个选择", async () => {
  const h=await browserHarness("local"), r=nopeRoom();
  const digits=[{}],notes=[{}],bars=[{style:{}}],classes=new Set();
  const panels=[{classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}}], buttons=[{}],passButtons=[{}];
  h.context.document.querySelectorAll=selector=>({
    "[data-nope-timer]":digits,"[data-nope-panel]":panels,"[data-nope-progress]":bars,
    '[data-action="nope"], [data-action="nope-response"]':buttons,
    '[data-action="nope-pass"]':passButtons,
  }[selector]||[]);
  await receiveNope(h,r);
  h.state.clockOffset=r.game.deadline-Date.now()-2000;
  vm.runInContext("countdown()",h.context);
  assert.equal(digits[0].textContent,"剩余 2 秒");
  assert(classes.has("urgent")); assert.equal(buttons[0].disabled,false);
  h.state.clockOffset=20000; vm.runInContext("countdown()",h.context);
  assert.equal(buttons[0].disabled,true); assert.equal(passButtons[0].disabled,true);
});

for (const seconds of [15,10,5]) test(`常驻否定栏 ${seconds} 秒真实进度，响应后本人计时及进度结束`,()=>{
 const r=nopeRoom();r.options.nopeSeconds=seconds;r.game.deadline=r.serverNow+seconds*1000;
 let p=ui.nopePanel(r,r.serverNow+seconds*300);
 assert.equal(p.canPass,true);assert.equal(Math.round(p.progress),70);
 assert.match(p.timerText,/剩余.*秒/);
 r.game.pending.responses={a:"passed",b:"waiting"};p=ui.nopePanel(r,r.serverNow+seconds*400);
 assert.equal(p.remaining,0);assert.equal(p.progress,0);assert.equal(p.timerText,"已响应");assert.equal(p.canNope,false);
 r.game.pending.nopeCount++;r.game.pending.responses={a:"waiting",b:"played"};r.game.deadline=r.serverNow+seconds*2000;
 assert.equal(ui.nopePanel(r,r.game.deadline-seconds*1000).progress,100);
});
test("常驻否定栏闲置/旁观/截止保持灰态，无否定牌仍能确认不出",()=>{
 const r=nopeRoom(0,[]);assert.equal(ui.nopePanel(r,r.serverNow).canNope,false);assert.equal(ui.nopePanel(r,r.serverNow).canPass,true);
 r.game.players[0].alive=false;assert.equal(ui.nopePanel(r,r.serverNow).progress,0);
 r.game.players[0].alive=true;assert.equal(ui.nopePanel(r,r.game.deadline).timerText,"等待结算");
 r.game.phase="action";const idle=ui.nopePanel(r,r.serverNow);assert.equal(idle.timerText,"暂无响应");assert.equal(idle.canPass,false);assert.equal(idle.progress,0);
 assert.equal(ui.nopePanel(null),null);
});
test("browser 常驻紧凑否定栏保留禁用选项，已响应没有本人计时",async()=>{
 const h=await browserHarness("local");await receiveNope(h,{...structuredClone(room),code:"123456",serverNow:Date.now()});
 assert.match(h.nodes["#app"].innerHTML,/data-nope-panel/);assert.match(h.nodes["#app"].innerHTML,/暂无响应/);
 assert.match(h.nodes["#app"].innerHTML,/data-action="nope-response"[^>]*disabled/);
 const r=nopeRoom();await receiveNope(h,r);assert.match(h.nodes["#app"].innerHTML,/剩余 10 秒/);
 r.game.pending.responses={a:"passed",b:"waiting"};r.revision++;await receiveNope(h,r);
 assert.match(h.nodes["#app"].innerHTML,/已响应/);assert.match(h.nodes["#app"].innerHTML,/data-action="nope-pass"[^>]*disabled/);
 assert.equal(h.state.nopeInfo.progress,0);
});
test("native 常驻灰态与截止一致，普通同步不重播行动",()=>{
 const page=nativeHarness();page.accept({...structuredClone(room),serverNow:Date.now()});assert.equal(page.data.nopeInfo.timerText,"暂无响应");
 const r=nopeRoom();page.accept(r);r.game.pending.responses={a:"passed",b:"waiting"};r.revision++;page.accept(r);
 assert.equal(page.data.nopeInfo.timerText,"已响应");assert.equal(page.data.nopeInfo.progress,0);
});

test("native 公开行动带回牌桌，普通同步和私密抽牌不改滚动位置",()=>{
 const scrolls=[];const page=nativeHarness(()=>1,{}, {pageScrollTo:options=>scrolls.push(options)});
 page.data.room=structuredClone(room);let r=structuredClone(room);
 r.game.logs=[{id:1,cardEvent:{kind:"play",actor:"a",target:"b",cards:[{id:"played",type:"attack"}]}}];
 page.accept(r);assert.equal(scrolls.length,1);assert.equal(scrolls[0].scrollTop,0);
 page.accept({...r,revision:12});assert.equal(scrolls.length,1);
 const other=nativeHarness(()=>1,{}, {pageScrollTo:options=>scrolls.push(options)});other.data.room=structuredClone(room);
 r=structuredClone(room);r.game.hand.push({id:"private",type:"skip"});other.accept(r);assert.equal(scrolls.length,1);
});
test("browser 公开行动带回牌桌，私密抽牌不会抢走查看位置",async()=>{
 const h=await browserHarness("local"),scrolls=[];
 h.nodes["#motion-host"]={style:{},innerHTML:""};
 h.nodes[".board-stage"]={scrollIntoView:options=>scrolls.push(options)};
 vm.runInContext('S.motion={kind:"play",title:"甲出牌"};renderMotion()',h.context);assert.equal(scrolls.length,1);
 vm.runInContext('S.motion={kind:"draw",title:"新牌"};renderMotion()',h.context);assert.equal(scrolls.length,1);
});

test("browser 精简首屏移除教学和桌面说明，保留手牌与两枚操作", async () => {
  const h = await browserHarness("local");
  const r = { ...structuredClone(room), code: "123456", serverNow: Date.now() };
  r.game.direction = -1;
  r.game.rulesVersion = "ek-imploding-2023-online-v1";
  r.players[1].isBot = true;
  await receiveNope(h, r);
  const html = h.nodes["#app"].innerHTML;
  assert.doesNotMatch(html, /轻点选牌|左右滑动查看手牌|table-direction|table-brand|Bot ·/);
  assert.match(html, /手牌 <span>3<\/span>/);
  assert.match(html, /data-action="hand-toggle"/);
  assert.match(html, /data-action="prepare"[^>]*disabled/);
  assert.match(html, /data-action="draw"[^>]*>抽牌<\/button>/);
  assert.doesNotMatch(html, /selection-preview/);
  await h.click("card", { id: "1" });
  assert.match(h.nodes["#app"].innerHTML, /selection-preview/);
  assert.match(h.nodes["#app"].innerHTML, /data-action="detail"/);
  assert.match(h.nodes["#app"].innerHTML, /data-action="prepare"[^>]*disabled/);
  await h.click("card", { id: "2" });
  assert.doesNotMatch(h.nodes["#app"].innerHTML, /data-action="prepare"[^>]*disabled/);
  await h.click("prepare");
  assert.equal(h.state.modal, "play");
  assert.match(h.nodes["#app"].innerHTML, /选择一位对手/);
});

test("browser 固定抽牌入口在其他回合、否定及旁观态保留但禁用", async () => {
  for (const state of ["other", "nope", "spectator"]) {
    const h = await browserHarness("local");
    const r = { ...structuredClone(room), code: "123456", serverNow: Date.now() };
    if (state === "other") r.game.current = "b";
    if (state === "nope") { r.game.phase = "nope"; r.game.pending = { nopeCount: 0 }; }
    if (state === "spectator") r.game.players[0].alive = false;
    await receiveNope(h, r);
    assert.match(h.nodes["#app"].innerHTML, /data-action="draw"[^>]*disabled[^>]*>抽牌<\/button>/, state);
    await h.click("draw");
    assert.equal(h.requests.filter(x => x.url.includes("/command")).length, 0, state);
  }
});

test("native 常驻抽牌操作不能从非本人回合、否定或旁观态提交", async () => {
  for (const state of ["other", "nope", "spectator"]) {
    const page = nativeHarness();
    const r = structuredClone(room);
    if (state === "other") r.game.current = "b";
    if (state === "nope") { r.game.phase = "nope"; r.game.pending = { nopeCount: 0 }; }
    if (state === "spectator") r.game.players[0].alive = false;
    page.accept(r);
    const calls = []; page.command = async (...args) => calls.push(args);
    await page.action({currentTarget:{dataset:{action:"draw"}}});
    assert.equal(calls.length, 0, state);
  }
});
