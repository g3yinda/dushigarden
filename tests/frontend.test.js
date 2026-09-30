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
    assert.deepEqual(controller.derive(r, [], true).botCounts, [1, 2, 3]);
    assert.equal(controller.derive(r, [], true).canAddBots, true);
    assert.equal(controller.derive(r, [], false).canAddBots, false);
    r.me = "b";
    assert.equal(controller.derive(r, [], true).canAddBots, false);
    r.me = "a";
    r.players.push({ id: "c" }, { id: "d" }, { id: "e" });
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
      assert.deepEqual(bot.targets.map((p) => p.id), human.targets.map((p) => p.id));
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
function nativeHarness() {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../miniprogram/pages/home/home.js"), "utf8"), {
    require: (name) => name.includes("controller") ? ui : { localMode: true },
    Page: (definition) => { page = definition; },
    setTimeout: () => 1, clearTimeout() {},
  });
  page.setData = (update) => Object.assign(page.data, update);
  page.accept(waitingRoom());
  page.notices = [];
  page.notice = (message) => page.notices.push(message);
  return page;
}
async function browserHarness(mode) {
  const handlers = {}, nodes = { "#app": { innerHTML: "" }, "#toast": { style: {} } };
  const requests = [];
  const context = vm.createContext({
    BoomUI: require("../web/controller"),
    sessionStorage: { getItem: () => null }, localStorage: { getItem: () => null },
    document: {
      body: { classList: { toggle() {} } },
      querySelector: (selector) => nodes[selector] || null,
      addEventListener: (event, handler) => { handlers[event] = handler; },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, mode }) };
    },
    location: { search: "", origin: "http://localhost" }, URLSearchParams,
    setInterval() {}, setTimeout: () => 1, clearTimeout() {},
    crypto: require("node:crypto"),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../web/app.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    context, requests, nodes,
    state: vm.runInContext("S", context),
    click: (action) => handlers.click({ target: { closest: () => ({ dataset: { action } }) } }),
  };
}
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
    return new Promise((resolve) => { complete = resolve; });
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
  page.request = async () => { throw Object.assign(Error("changed"), { status: 409 }); };
  let refreshed = false;
  page.refresh = async () => { refreshed = true; };
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
    assert.equal(h.nodes["#app"].innerHTML.includes("添加验证 Bot"), mode === "local");
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
    return new Promise((resolve) => { complete = resolve; });
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
  h.context.fetch = async (url) => url.endsWith("/bots")
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
  page.pollRequest = { abort: () => { aborted = true; } };
  page.request = (url) => {
    if (url.includes("?after=")) {
      oldEpoch = page.epoch;
      return new Promise((resolve, reject) => { rejectPoll = reject; });
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
  page.poll = () => { restarts++; };
  page.request = async () => {
    assert(page.epoch > 10, "old poll must be invalid before leave HTTP starts");
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
      return new Promise((resolve, reject) => { rejectPoll = reject; });
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
  h.context.restartPoll = () => { restarts++; };
  vm.runInContext("poll = restartPoll", h.context);
  h.context.fetch = async () => {
    assert(h.state.poll > 10, "old poll must be invalid before leave HTTP starts");
    throw Error("离房失败");
  };
  await h.click("leave-submit");
  assert.equal(h.state.room.code, "123456");
  assert.equal(h.state.busy, false);
  assert.equal(restarts, 1);
  assert.equal(h.nodes["#toast"].textContent, "离房失败");
});
