const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const U = require("../miniprogram/lib/controller");
const rendererPath = "../miniprogram/lib/canvas-ui";
function room(
  n = 6,
  phase = "action",
  types = [
    "skip",
    "nope",
    "cat1",
    "cat1",
    "cat1",
    "favor",
    "targetAttack",
    "alterFuture",
    "bomb",
  ],
) {
  const players = Array.from({ length: n }, (_, i) => ({
    id: "p" + i,
    name: "猫咪" + i,
    avatar: i % 4,
    alive: true,
    count: 8,
    ready: true,
  }));
  return {
    code: "123456",
    status: "playing",
    me: "p0",
    hostId: "p0",
    options: { nopeSeconds: 10 },
    serverNow: 1000,
    players,
    game: {
      id: "g",
      players,
      phase,
      current: "p0",
      remaining: 1,
      deckCount: 20,
      hand: types.map((type, i) => ({ id: "c" + i, type })),
      discard: [{ id: "d", type: "attack" }],
      logs: [],
      privateLog: [],
      rulesVersion: "ek-imploding-2023-online-v1",
      deadline: 11000,
      pending:
        phase === "nope"
          ? { actor: "p1", type: "attack", nopeCount: 0, responses: {} }
          : phase === "favor"
            ? { target: "p0" }
            : null,
    },
  };
}
function harness(w = 390, h = 844) {
  let definition;
  const calls = [],
    images = [],
    draws = [];
  const wx = {
    getStorageSync() {},
    setStorageSync() {},
    showToast() {},
    shareAppMessage: (o) => calls.push({ share: o }),
    createImage() {
      let im = { width: 1536, height: 1024 };
      Object.defineProperty(im, "src", {
        set(v) {
          im.path = v;
          images.push(im);
          if (im.onload) im.onload();
        },
      });
      return im;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      require.resolve("../miniprogram/pages/home/home.js"),
      "utf8",
    ),
    {
      require: (n) => (n.includes("controller") ? U : { localMode: true }),
      Page: (p) => (definition = p),
      wx,
      setTimeout: () => 0,
      clearTimeout() {},
    },
  );
  const page = definition;
  page.setData = (p) => require("./native-data").applyData(page.data, p);
  page.command = async (a, p) => calls.push({ action: a, ...p });
  page.offset = 1000 - Date.now();
  const ctx = new Proxy(
    {
      measureText: (s) => ({ width: Array.from(String(s)).length * 7 }),
      drawImage: (...a) => draws.push(a),
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
  const canvas = { getContext: () => ctx };
  let CanvasUI;
  try {
    CanvasUI = require(rendererPath).CanvasUI;
  } catch (e) {
    assert.fail("CanvasUI renderer module is missing");
  }
  const ui = new CanvasUI({
    canvas,
    wx,
    page,
    info: {
      windowWidth: w,
      windowHeight: h,
      pixelRatio: 2,
      statusBarHeight: 24,
      safeArea: { bottom: h - 20 },
    },
    onInput: (f) => calls.push({ input: f }),
  });
  function accept(r, selected = []) {
    page.data.room = r;
    page.data.v = U.derive(r, selected, true);
    page.data.selected = selected;
    page.data.namedOptions = U.namedOptions(r);
    page.data.futureState = U.futureOrder(r, null);
    page.data.nopeInfo = U.nopePanel(r, 1000);
    ui.render(1000);
  }
  function tap(region) {
    assert(region, "expected visible control");
    const x = region.x + region.w / 2,
      y = region.y + region.h / 2;
    ui.touchStart({ touches: [{ clientX: x, clientY: y }] });
    ui.touchEnd({ changedTouches: [{ clientX: x, clientY: y }] });
    ui.render(1000);
  }
  function find(a, id) {
    return ui.layout.regions.find(
      (r) => r.action === a && (id === undefined || r.id === id),
    );
  }
  function reach(a, id) {
    let r = find(a, id);
    if (r && r.h >= 40) return r;
    const modal = !!ui.layout.modal;
    for (const offset of [0, 120, 240, 360, 480, 600, 720, 840, 960, 1200]) {
      if (modal) ui.modalScroll = Math.min(offset, ui.modalMax || 0);
      else ui.pageScroll = Math.min(offset, ui.pageMax || 0);
      ui.render(1000);
      r = find(a, id);
      if (r && r.h >= 40) return r;
    }
    return r;
  }
  return { ui, page, wx, calls, images, draws, accept, tap, find, reach };
}
for (const [w, h] of [
  [320, 568],
  [390, 844],
  [430, 932],
]) {
  test(`home and create all controls fit ${w}x${h}`, () => {
    const x = harness(w, h);
    x.page.data.canResume = true;
    x.ui.render(1000);
    for (const a of [
      "profile",
      "input",
      "create",
      "join",
      "resume",
      "rules",
      "settings",
    ]) {
      const r = x.find(a);
      assert(r, a);
      assert(r.y >= 24 && r.y + r.h <= h - 20, a);
      assert(r.h >= 44, a);
    }
    x.tap(x.find("create"));
    for (const a of [
      "close",
      "roomSetting",
      "expansionSetting",
      "nope-time",
      "create-submit",
    ])
      assert(x.find(a), a);
    assert.equal(
      x.ui.layout.regions.filter((r) => r.action === "nope-time").length,
      4,
    );
    assert.equal(
      x.ui.layout.regions.filter((r) => r.action === "expansionSetting").length,
      3,
    );
    for (const r of x.ui.layout.regions) assert(r.y + r.h <= h - 20);
  });
  test(`six seats stay inside table, fixed dock remains accessible ${w}x${h}`, () => {
    const x = harness(w, h);
    x.accept(room());
    const { table, seats, dock, hand } = x.ui.layout;
    assert.equal(seats.length, 6);
    for (const s of seats) {
      assert(s.x >= table.x);
      assert(s.x + s.w <= table.x + table.w);
      assert(s.y >= table.y);
      assert(s.y + s.h <= table.y + table.h);
    }
    assert.equal(x.ui.layout.scroll.max, 0);
    assert(x.find("card", "c0"));
    assert(hand.y + hand.h <= dock.y - 6);
    for (const a of ["nope-response", "nope-pass", "prepare", "draw"]) {
      const r = x.find(a);
      assert(r);
      assert(r.y + r.h <= h - 20);
    }
  });
}
test("all 2–6 actual table seat orders rotate around current player", () => {
  for (let n = 2; n <= 6; n++) {
    const x = harness();
    const r = room(n);
    r.me = "p1";
    x.accept(r);
    assert.equal(x.ui.layout.seats[0].id, "p1");
    assert.equal(x.ui.layout.seats.length, n);
  }
});
test("waiting always has two columns and host controls", () => {
  const x = harness(320, 568);
  const r = room(4);
  delete r.game;
  r.status = "waiting";
  x.accept(r);
  assert.equal(new Set(x.ui.layout.seats.map((s) => s.x)).size, 2);
  for (const a of ["share", "copy", "bots", "ready", "start", "kick"])
    assert(x.reach(a), a);
  x.tap(x.reach("share"));
  assert.equal(x.calls[0].share.query, "room=123456");
});
test("nickname keyboard delegates and image cache survives taps", () => {
  const x = harness();
  x.ui.render(1);
  const n = x.images.length;
  assert(n > 0);
  x.tap(x.find("input"));
  assert.equal(x.calls[0].input, "name");
  x.tap(x.find("profile"));
  x.tap(x.find("avatar", 1));
  assert.equal(x.images.length, n);
  assert.equal(x.page.data.avatar, 1);
  assert(x.draws.some((a) => a.length === 9));
});
test("hand tap selects, drag scrolls without selection, multi-select and clear preserve expansion", () => {
  const x = harness();
  x.accept(room());
  x.tap(x.find("card", "c0"));
  assert.deepEqual(Array.from(x.page.data.selected), ["c0"]);
  x.tap(x.find("card", "c1"));
  assert.equal(x.page.data.selected.length, 2);
  const r = x.find("card", "c2");
  const sx = r.x + r.w / 2,
    sy = r.y + r.h / 2;
  x.ui.touchStart({ touches: [{ clientX: sx, clientY: sy }] });
  x.ui.touchMove({ touches: [{ clientX: sx - 90, clientY: sy }] });
  x.ui.touchEnd({ changedTouches: [{ clientX: sx - 90, clientY: sy }] });
  x.ui.render(1000);
  assert.equal(x.page.data.selected.length, 2);
  assert(x.ui.layout.hand.offset > 0);
  x.tap(x.find("hand-toggle"));
  assert(x.page.data.handExpanded);
  x.tap(x.find("clear"));
  assert.equal(x.page.data.selected.length, 0);
  assert(x.page.data.handExpanded);
});
test("nope carries window key and disables unavailable buttons", () => {
  const x = harness();
  x.accept(room(6, "nope"));
  assert(!x.find("nope-response").disabled);
  x.tap(x.find("nope-response"));
  assert.equal(x.calls[0].action, "nope");
  x.accept(room(6, "action"));
  assert(x.find("nope-response").disabled);
  x.tap(x.find("nope-response"));
  assert.equal(x.calls.length, 1);
});
test("create switches call existing state handlers and nope times", () => {
  const x = harness();
  x.page.data.modal = "create";
  x.ui.render();
  x.tap(x.find("roomSetting"));
  assert(x.page.data.noTurnTimer);
  const r = x.ui.layout.regions.find((r) => r.field === "includeImploding");
  x.tap(r);
  assert.equal(x.page.data.includeImploding, false);
  x.tap(x.ui.layout.regions.find((r) => r.seconds === 0));
  assert.equal(x.page.data.nopeSeconds, 0);
});
test("modal backdrop prevents clickthrough and settings/rules retain reachable close", () => {
  const x = harness();
  x.accept(room());
  x.page.data.modal = "settings";
  x.ui.render();
  assert(!x.find("draw"));
  x.tap(x.ui.layout.regions.find((r) => r.field === "reduced"));
  assert(x.page.data.settings.reduced);
  x.tap(x.find("rules"));
  assert.equal(x.page.data.modal, "rules");
  assert(x.find("close"));
  x.tap(x.find("close"));
  assert.equal(x.page.data.modal, "");
});
test("three-card combo chooses player and every card name in the same non-scrolling dialog", () => {
  for (const [w,h] of [[320,412],[320,568],[390,844],[430,932]]) {
    const x=harness(w,h);x.accept(room(),["c2","c3","c4"]);
    x.page.data.modal="play";x.ui.render();
    assert(x.find("choice-tab").disabled);
    x.tap(x.find("target","p1"));x.tap(x.find("choice-tab"));
    assert.equal(x.ui.layout.modal,"play");assert.equal(x.ui.picker,null);
    const box={...x.ui.layout.modalRect};
    const seen=new Set();
    for(let page=0;page<Math.ceil(x.page.data.namedOptions.length/6);page++) {
      for(const option of x.ui.layout.regions.filter(r=>r.action==="choice-named")) {
        assert(option.h>=44-1e-6 && option.w>=44);
        assert(option.y>=box.y && option.y+option.h<=box.y+box.h);
        x.tap(option);seen.add(option.index);assert.equal(x.page.data.namedIndex,option.index);
      }
      const next=x.ui.layout.regions.find(r=>r.action==="choice-page"&&r.step===1);
      if(!next.disabled)x.tap(next);
      assert.equal(x.ui.layout.scroll.max,0);assert.deepEqual(x.ui.layout.modalRect,box);
    }
    assert.equal(seen.size,x.page.data.namedOptions.length);
    assert(!x.find("play").disabled);
    x.tap(x.find("choice-tab"));assert(x.find("target","p1"));
    x.tap(x.find("choice-tab"));x.tap(x.find("play"));
    assert.equal(x.calls.at(-1).action,"play");assert.equal(x.calls.at(-1).target,"p1");
    assert.equal(x.calls.at(-1).named,x.page.data.named);
  }
});
for (const [phase, control] of [
  ["future", "closeFuture"],
  ["alterFuture", "orderFuture"],
  ["defuse", "defuse"],
  ["insert", "insert"],
  ["favor", "give"],
])
  test(`private ${phase} exposes ${control} and hides it from spectators`, () => {
    const x = harness();
    const r = room(6, phase);
    if (["future", "alterFuture"].includes(phase))
      r.game.future = [
        { id: "f1", type: "bomb" },
        { id: "f2", type: "skip" },
        { id: "f3", type: "nope" },
      ];
    if (phase === "insert") r.game.bomb = { type: "imploding", faceUp: true };
    x.accept(r, phase === "favor" ? ["c0"] : []);
    assert(x.reach(control));
    if (phase === "alterFuture") {
      assert(x.reach("future-up"));
      assert(x.reach("future-down"));
    }
    r.me = "p2";
    x.accept(r);
    assert(!x.find(control));
  });
test("position stepper reaches all deck positions and shortcuts in one dialog", () => {
  const x=harness(320,412),r=room(6,"insert");r.game.deckCount=67;x.accept(r);
  const at=(index)=>x.ui.layout.regions.find(b=>b.action==="choice-position"&&b.index===index);
  const plus=()=>x.ui.layout.regions.filter(b=>b.action==="choice-position")[1];
  const minus=()=>x.ui.layout.regions.filter(b=>b.action==="choice-position")[0];
  assert(minus().disabled);
  for(let i=1;i<=67;i++) {x.tap(plus());assert.equal(x.page.data.position,i+1);}
  assert(plus().disabled);x.tap(minus());assert.equal(x.page.data.position,67);
  x.tap(at(0));assert.equal(x.page.data.position,1);
  x.tap(at(67));assert.equal(x.page.data.position,68);
  x.tap(at(-1));assert(x.page.data.position>=1&&x.page.data.position<=68);
  assert.equal(x.ui.layout.scroll.max,0);assert.equal(x.ui.picker,null);
  x.tap(x.find("insert"));assert.equal(x.calls.at(-1).position,x.page.data.position);
});
test("leave and room-close preserve two confirmation levels", () => {
  const x = harness();
  x.accept(room());
  x.tap(x.find("leave"));
  assert(x.find("leave-submit"));
  x.tap(x.find("close-room"));
  assert.equal(x.page.data.modal, "close-room");
  assert(x.find("close-room-submit"));
  assert(!x.find("leave-submit"));
});
test("finished screen has rematch and leave without fixed action dock", () => {
  const x = harness();
  const r = room(6, "finished");
  r.game.winner = "p1";
  x.accept(r);
  assert(x.find("rematch"));
  assert(x.find("leave"));
  assert(!x.find("draw"));
});
test("motion renders cached art, entrance exit and explosion; reduced mode needs no animation frames", () => {
  const x = harness();
  x.accept(room());
  x.page.data.motionItems = [
    {
      renderId: 1,
      kind: "bomb",
      explosion: true,
      actor: x.page.data.v.players[0],
      title: "抽到了炸弹猫！",
      card: U.card({ type: "bomb" }),
    },
  ];
  x.ui.render(1000);
  assert(x.ui.needsFrame());
  assert.equal(x.ui.layout.motion.explosion, true);
  x.ui.render(5900);
  assert(x.ui.layout.motion.opacity < 1);
  x.page.data.settings.reduced = true;
  x.ui.render(5950);
  assert.equal(x.ui.needsFrame(), false);
  assert.equal(x.ui.layout.motion.opacity, 1);
  x.ui.destroy();
  assert.equal(x.ui.needsFrame(), false);
});
test("vertical gesture cannot scroll a private dialog or trigger the pressed action", () => {
  const x = harness(320, 568);
  const r = room(6, "alterFuture");
  r.game.future = [
    { id: "f1", type: "bomb" },
    { id: "f2", type: "skip" },
    { id: "f3", type: "nope" },
  ];
  x.accept(r);
  const dockY = x.ui.layout.dock.y;
  const handY = x.ui.layout.hand.y;
  const viewport = x.ui.layout.scroll.viewport;
  const sx = 100,
    sy = viewport.y + 120;
  x.ui.touchStart({ touches: [{ clientX: sx, clientY: sy }] });
  x.ui.touchMove({ touches: [{ clientX: sx, clientY: sy - 100 }] });
  x.ui.touchEnd({ changedTouches: [{ clientX: sx, clientY: sy - 100 }] });
  x.ui.render(1000);
  assert.equal(x.ui.pageScroll, 0);
  assert.equal(x.ui.modalScroll, 0);
  assert.equal(x.ui.layout.dock.y, dockY);
  assert.equal(x.ui.layout.hand.y, handY);
  assert.equal(x.calls.length, 0);
  assert(x.reach("orderFuture"));
});
test("touch cancellation prevents a later end event from selecting a card", () => {
  const x = harness();
  x.accept(room());
  const r = x.find("card", "c0"),
    p = { clientX: r.x + 15, clientY: r.y + 40 };
  x.ui.touchStart({ touches: [p] });
  x.ui.touchCancel();
  x.ui.touchEnd({ changedTouches: [p] });
  assert.equal(x.page.data.selected.length, 0);
});
test("private dialog yields to persistent exit confirmation and rejects stale phase gestures", () => {
  const x=harness();x.accept(room(3,"defuse"));
  const button=x.find("defuse"),p={clientX:button.x+20,clientY:button.y+20};
  x.ui.touchStart({touches:[p]});x.accept(room(3,"insert"));
  x.ui.touchEnd({changedTouches:[p]});assert.equal(x.calls.length,0);
  x.tap(x.find("leave"));assert.equal(x.page.data.modal,"leave");
  x.accept(room(3,"action"));assert.equal(x.ui.layout.modal,"leave");
  x.accept(room(3,"future"));assert.equal(x.ui.layout.modal,"leave");
  x.tap(x.find("close"));assert.equal(x.ui.layout.modal,"phase-choice");
  x.accept(room(3,"action"));assert.equal(x.ui.layout.modal,"");assert(x.find("draw"));
});
test("bots picker and switch preserve real add-Bot state", () => {
  const x = harness();
  const r = room(2);
  delete r.game;
  r.status = "waiting";
  x.accept(r);
  x.tap(x.find("bots"));
  x.tap(x.find("picker"));
  x.tap(
    x.ui.layout.regions.find(
      (r) => r.action === "pick-option" && r.index === 2,
    ),
  );
  assert.equal(x.page.data.botCount, 3);
  x.tap(x.find("botSetting"));
  assert(x.page.data.respondNope);
  assert(x.find("bots-submit"));
});
test("modal outside taps do not play or draw hidden cards", () => {
  const x = harness();
  x.accept(room());
  const old = x.find("draw");
  x.page.data.modal = "join";
  x.ui.render();
  x.ui.touchStart({ touches: [{ clientX: old.x + 10, clientY: old.y + 10 }] });
  x.ui.touchEnd({
    changedTouches: [{ clientX: old.x + 10, clientY: old.y + 10 }],
  });
  assert.equal(x.calls.length, 0);
  assert.equal(x.page.data.modal, "join");
});
test("asynchronous atlas load schedules invalidation once and does not refetch", () => {
  let invalidated = 0,
    im,
    created = 0;
  const ctx = new Proxy(
    { measureText: (s) => ({ width: String(s).length * 7 }) },
    { get: (t, k) => t[k] || (() => {}) },
  );
  const { CanvasUI } = require(rendererPath);
  const page = { data: { name: "", selected: [], settings: {} } };
  const ui = new CanvasUI({
    canvas: { getContext: () => ctx },
    wx: {
      createImage() {
        created++;
        return (im = { width: 1536, height: 1024 });
      },
    },
    page,
    info: { windowWidth: 390, windowHeight: 844, pixelRatio: 3 },
    onInvalidate: () => invalidated++,
  });
  assert.equal(created, 4);
  im.onload();
  assert.equal(invalidated, 1);
  assert(ui.needsFrame());
  ui.render(10);
  assert.equal(ui.needsFrame(), false);
  ui.render(11);
  assert.equal(created, 4);
  ui.destroy();
  assert.equal(im.onload, null);
});
test("safe-area resize repositions controls while retaining logical DPR coordinates", () => {
  const x = harness();
  x.accept(room());
  x.ui.resize({
    windowWidth: 430,
    windowHeight: 932,
    pixelRatio: 3,
    statusBarHeight: 26,
    safeArea: { bottom: 898 },
  });
  x.ui.render(1000);
  const r = x.find("draw");
  assert(r.x + r.w <= 430);
  assert(r.y + r.h <= 898);
  assert.equal(x.ui.dpr, 3);
  x.tap(r);
  assert.equal(x.calls[0].action, "draw");
});
test("ineligible player sees neither private future cards nor a reorder method", () => {
  const x = harness();
  const r = room(6, "alterFuture");
  r.game.future = [{ id: "secret", type: "bomb" }];
  r.me = "p4";
  x.accept(r);
  assert.equal(x.page.data.futureState, null);
  assert.equal(x.page.data.v.future.length, 0);
  assert(!x.find("orderFuture"));
  assert(!x.find("future-up"));
});
test("phase content shrinking clamps scroll so the normal hand remains reachable", () => {
  const x = harness();
  const r = room(6, "alterFuture");
  r.game.future = [
    { id: "f1", type: "bomb" },
    { id: "f2", type: "skip" },
    { id: "f3", type: "nope" },
  ];
  x.accept(r);
  x.ui.pageScroll = x.ui.pageMax;
  x.ui.render(1000);
  x.accept(room());
  assert(x.ui.pageScroll <= x.ui.layout.scroll.max);
  assert(x.find("card", "c0"));
});
test("home uses the approved atlas window from final WXSS hero crop", () => {
  const x = harness();
  x.ui.render(1000);
  const crop = x.draws[0];
  assert(Math.abs(crop[3] - 1536 / 3.56381) < 0.001);
  assert(Math.abs(crop[1] - (0.12761 * 1536) / 3.56381) < 0.001);
});
test("small discard card keeps every label inside its own bounds", () => {
  const x = harness();
  x.ui.render(1000);
  const labels = [];
  x.ui.ctx.fillText = (text, a, b) => labels.push({ text, x: a, y: b });
  x.ui.card(U.card({ type: "targetAttack" }), 20, 20, 58, 79);
  assert(labels.every((label) => label.y <= 99));
  assert(
    labels.some(
      (label) => label.text.includes("攻击") || label.text.includes("定"),
    ),
  );
});
test("header respects the actual capsule rectangle even when it differs from status-bar estimates", () => {
  const x = harness();
  x.ui.resize({
    windowWidth: 390,
    windowHeight: 844,
    pixelRatio: 2,
    statusBarHeight: 24,
    safeArea: { bottom: 824 },
    menu: { left: 280, right: 380, top: 80, bottom: 120 },
  });
  x.accept(room());
  const settings = x.find("settings");
  assert(
    settings.y >= 128,
    "header setting must clear capsule bottom with an 8 px gap",
  );
  assert(x.ui.layout.scroll.viewport.y >= 128 + 54);
  x.page.data.room = null;
  x.ui.render(1000);
  assert(x.find("profile").y >= 128);
});
test("short-screen hand is visible while empty clips and dock gaps remain noninteractive", () => {
  const x = harness(320, 568);
  x.accept(room());
  assert(x.find("card", "c0"));
  x.ui.clip({ x: 0, y: 480, w: 320, h: 0 }, () => {
    x.ui.region("card", 0, 480, 100, 100, { id: "hidden" });
  });
  assert.equal(x.find("card", "hidden"), undefined);
  const p = { clientX: 40, clientY: x.ui.layout.dock.y - 3 };
  x.ui.touchStart({ touches: [p] });
  x.ui.touchEnd({ changedTouches: [p] });
  assert.equal(x.page.data.selected.length, 0);
});
test("compact create rows never overlap submission when a tall capsule reduces space to 412 px", () => {
  const x = harness(320, 568);
  x.ui.resize({
    windowWidth: 320,
    windowHeight: 568,
    pixelRatio: 2,
    statusBarHeight: 24,
    safeArea: { bottom: 548 },
    menu: { bottom: 120 },
  });
  x.page.data.modal = "create";
  x.ui.render(1000);
  const reverse = x.ui.layout.regions.find((r) => r.field === "includeReverse"),
    submit = x.find("create-submit");
  assert(reverse.h >= 44);
  assert(
    reverse.y + reverse.h <= submit.y,
    "reverse switch must finish before creation begins",
  );
  assert(submit.y + submit.h <= 548 - 28);
  const p = {
    clientX: reverse.x + reverse.w - 27,
    clientY: reverse.y + reverse.h / 2,
  };
  x.ui.touchStart({ touches: [p] });
  x.ui.touchEnd({ changedTouches: [p] });
  assert.equal(x.page.data.includeReverse, false);
  assert.equal(x.page.data.modal, "create");
  assert.equal(x.calls.length, 0);
});
test("Bot modal hugs its content on a tall screen while retaining all controls", () => {
  const x = harness();
  const r = room(2);
  delete r.game;
  r.status = "waiting";
  x.accept(r);
  x.page.data.modal = "bots";
  x.ui.render(1000);
  assert(
    x.ui.layout.modalRect.h < 500,
    "Bot dialog must not use a mostly empty 620px panel",
  );
  assert(x.find("picker"));
  assert(x.find("botSetting"));
  assert(x.find("bots-submit"));
  assert.equal(x.ui.layout.scroll.max, 0);
});
test("create at the 440 px layout boundary keeps the reverse switch separate from submit", () => {
  const x = harness(320, 568);
  x.ui.resize({
    windowWidth: 320,
    windowHeight: 568,
    pixelRatio: 2,
    statusBarHeight: 24,
    safeArea: { bottom: 548 },
    menu: { bottom: 92 },
  });
  x.page.data.modal = "create";
  x.ui.render(1000);
  assert.equal(x.ui.layout.modalRect.h, 440);
  const reverse = x.ui.layout.regions.find(
    (region) => region.field === "includeReverse",
  );
  const submit = x.find("create-submit");
  assert(
    reverse.y + reverse.h <= submit.y,
    "440 px create panel must not overlap its reverse switch and submission",
  );
});

test("fixed game zones keep the whole hand visible and stable through phases and selection", () => {
  for (const [w, h] of [[320,568],[390,844],[430,932]]) {
    const x = harness(w,h);
    x.accept(room());
    const initial = {...x.ui.layout.hand};
    const table = {...x.ui.layout.table};
    assert(initial.y + initial.h <= x.ui.layout.dock.y - 6, "full hand fits above dock");
    assert(x.find("card", "c0"), "hand is visible without vertical scrolling");
    assert.equal(x.ui.pageMax, 0);
    for (const phase of ["nope", "favor", "defuse", "insert", "future", "alterFuture"]) {
      const r = room(6,phase);
      if (["future","alterFuture"].includes(phase)) r.game.future=[{id:"f1",type:"bomb"},{id:"f2",type:"skip"},{id:"f3",type:"nope"}];
      x.accept(r, ["c0"]);
      assert.equal(x.ui.layout.hand.y, initial.y, phase+" must not push hand down");
      assert.deepEqual(x.ui.layout.table, table);
      assert.equal(!!x.find("card", "c0"), ["nope","favor"].includes(phase));
    }
    const r=room();r.game.deckTop={type:"imploding",faceUp:true};r.game.logs=[{text:"玩家抽到了炸弹猫"}];
    x.accept(r,["c0","c1"]);
    assert.equal(x.ui.layout.hand.y, initial.y);
  }
});

test("vertical dragging the normal table or hand cannot move either fixed zone", () => {
  const x=harness();x.accept(room());
  const before=x.ui.layout.hand.y;
  const p={clientX:100,clientY:before+40};
  x.ui.touchStart({touches:[p]});x.ui.touchMove({touches:[{clientX:100,clientY:p.clientY-100}]});x.ui.touchEnd({changedTouches:[{clientX:100,clientY:p.clientY-100}]});x.ui.render(1000);
  assert.equal(x.ui.layout.hand.y,before);assert.equal(x.ui.pageScroll,0);assert.equal(x.calls.length,0);
});

test("short-screen deck labels clear the player's avatar and the turn label stays in its seat", () => {
  const x = harness(320, 568);
  const labels = [];
  const text = x.ui.text.bind(x.ui);
  x.ui.text = (...args) => { labels.push(args); return text(...args); };
  for (let n = 2; n <= 6; n++) {
    labels.length = 0;
    x.accept(room(n));
    const me = x.ui.layout.seats.find(s => s.isMe);
    for (const label of labels.filter(a => /^牌堆 |^弃牌堆$/.test(a[0])))
      assert(label[2] <= me.y - 3, `deck label ${label[2]} clears avatar ${me.y} for ${n} seats`);
    const turn = labels.find(a => a[0].includes("回合"));
    assert(turn[2] >= me.y && turn[2] <= me.y + me.h, "turn information shares the player's label");
  }
});

test("fixed hand still exposes card details and settings exposes preserved match history", () => {
  const x = harness();
  const r = room();
  r.game.logs = [{text: "猫咪1打出了攻击"}];
  r.game.privateLog = [{text: "你看到了牌顶"}];
  x.accept(r, ["c0"]);
  x.tap(x.find("detail"));
  assert.equal(x.page.data.modal, "detail");
  x.tap(x.find("close"));
  x.tap(x.find("settings"));
  x.tap(x.reach("history"));
  assert.equal(x.page.data.modal, "history");
  assert.deepEqual(r.game.privateLog, [{text: "你看到了牌顶"}]);
  assert.deepEqual(r.game.logs, [{text: "猫咪1打出了攻击"}]);
});

test("being asked for a card only highlights the fixed hand, without covering the table", () => {
  for (const [w,h] of [[320,568],[390,844],[430,932]]) {
    const x=harness(w,h); x.accept(room());
    const handY=x.ui.layout.hand.y;
    const r=room(6,"favor");r.game.pending.actor="p1";
    x.accept(r,["c0"]);
    assert.equal(x.ui.layout.modal, "");
    assert.equal(x.ui.layout.privatePanel, null);
    assert.equal(x.ui.layout.hand.y,handY);
    assert.equal(x.ui.layout.hand.giving,true);
    assert(x.find("card","c0"));
    assert(x.find("give") && !x.find("give").disabled);
    x.tap(x.find("give"));
    assert.equal(x.calls.at(-1).action,"give");
    assert.equal(x.calls.at(-1).cardId,"c0");
  }
});

test("mandatory private choices fit one independent dialog on every supported screen", () => {
  for (const [w,h] of [[320,412],[320,568],[390,844],[430,932]]) {
    for (const [phase,action] of [["future","closeFuture"],["alterFuture","orderFuture"],["defuse","defuse"],["insert","insert"]]) {
      const x=harness(w,h),r=room(6,phase);
      r.game.future=[{id:"f1",type:"bomb"},{id:"f2",type:"alterFuture"},{id:"f3",type:"targetAttack"}];
      x.accept(r);
      assert.equal(x.ui.layout.modal,"phase-choice");
      assert.equal(x.ui.layout.scroll.max,0);
      assert(x.find(action),phase+" main control visible without scrolling");
      assert(!x.find("draw") && !x.find("card","c0"),"backdrop blocks underlying controls");
      const box=x.ui.layout.modalRect;
      for (const b of x.ui.layout.regions) {
        assert(b.y>=box.y && b.y+b.h<=box.y+box.h,phase+" control fits");
        assert(b.h>=44-1e-6 && b.w>=44-1e-6,JSON.stringify({w,h,phase,b}));
      }
    }
  }
});

test("favor hand selection replaces the previous choice and keeps the table unobstructed", () => {
  const x=harness();x.accept(room(6,"favor"));
  assert(x.find("give").disabled);x.tap(x.find("card","c0"));
  x.tap(x.find("card","c1"));assert.deepEqual(x.page.data.selected,["c1"]);
  assert(!x.find("give").disabled);x.tap(x.find("card","c1"));
  assert.deepEqual(x.page.data.selected,[]);assert(x.find("give").disabled);
  assert.equal(x.ui.layout.modal,"");assert.equal(x.ui.layout.privatePanel,null);
});

test("leave and close-room choices keep every action visible without scrolling on a short screen", () => {
  const x=harness(320,412);x.accept(room());x.tap(x.find("leave"));
  assert.equal(x.ui.layout.scroll.max,0);
  for(const b of x.ui.layout.regions) assert(b.y>=x.ui.layout.modalRect.y&&b.y+b.h<=x.ui.layout.modalRect.y+x.ui.layout.modalRect.h);
  assert(x.find("leave-submit")?.h>=44&&x.find("close-room")?.h>=44);
  x.tap(x.find("close-room"));assert.equal(x.ui.layout.scroll.max,0);assert(x.find("close-room-submit"));
});

test("compact selected hand cards stay below the title controls during favor", () => {
  const x=harness(320,568);x.accept(room(6,"favor"),["c0"]);
  const card=x.find("card","c0"),toggle=x.find("hand-toggle"),detail=x.find("detail");
  assert(card.y>=toggle.y+36&&card.y>=detail.y+36,"selected card must clear title pills");
});

test("favor recipient can give a card when someone else owns the turn", () => {
  const x=harness();const r=room(6,"favor");r.game.current="p1";r.game.pending.actor="p1";
  x.accept(r);assert(!x.page.data.v.turn);assert.equal(x.ui.layout.modal,"");
  x.tap(x.find("card","c0"));assert(!x.find("give").disabled);x.tap(x.find("give"));
  assert.deepEqual(x.calls.at(-1),{action:"give",cardId:"c0"});
});

test("future dialog shows complete expansion card names even at 320 px width", () => {
  const x=harness(320,412),r=room(6,"future"),labels=[];
  r.game.future=[{id:"f1",type:"bomb"},{id:"f2",type:"alterFuture"},{id:"f3",type:"targetAttack"}];
  x.ui.ctx.fillText=(text)=>labels.push(text);
  x.ui.ctx.measureText=(text)=>({width:Array.from(String(text)).length*12});x.accept(r);
  const painted=labels.join("").replace(/\s/g,"");
  for(const c of r.game.future) assert(painted.includes(U.card(c).name.replace(/\s/g,"")),"full card name: "+c.type);
});

test("reopening a three-card combo restarts target selection instead of retaining its named step", () => {
  const x=harness();x.accept(room(),["c2","c3","c4"]);x.tap(x.find("prepare"));
  x.tap(x.find("target","p1"));x.tap(x.find("choice-tab"));assert(x.find("choice-named"));
  x.tap(x.find("close"));x.tap(x.find("prepare"));
  assert(x.find("target","p1"));assert(!x.find("choice-named"));assert.equal(x.page.data.target,"");
});

test("targeted attack keeps all six targets visible and can submit self in one dialog", () => {
  for(const [w,h] of [[320,412],[320,568],[390,844],[430,932]]) {
    const x=harness(w,h);x.accept(room(),["c6"]);x.tap(x.find("prepare"));
    assert.equal(x.ui.layout.regions.filter(r=>r.action==="target").length,6);
    assert.equal(x.ui.layout.scroll.max,0);x.tap(x.find("target","p0"));
    assert(!x.find("play").disabled);x.tap(x.find("play"));
    assert.equal(x.calls.at(-1).target,"p0");assert.equal(x.calls.at(-1).action,"play");
  }
});

test("compact reorder buttons submit the exact chosen future permutation", () => {
  const x=harness(320,412),r=room(6,"alterFuture");
  r.game.future=[{id:"f1",type:"bomb"},{id:"f2",type:"skip"},{id:"f3",type:"nope"}];
  x.accept(r);x.tap(x.find("future-down","f1"));x.tap(x.find("orderFuture"));
  assert.deepEqual(JSON.parse(JSON.stringify(x.calls.at(-1))),{action:"orderFuture",order:["f2","f1","f3"]});
});

test("target dialog shows public hand counts including zero and refreshes them without losing selection", () => {
  const x=harness(),r=room(),labels=[];
  r.game.players[1].count=0;r.game.players[2].count=1;r.game.players[3].count=37;
  x.ui.ctx.fillText=(text)=>labels.push(text);
  x.accept(r,["c6"]);x.tap(x.find("prepare"));
  for(const count of [0,1,37]) assert(labels.includes("剩余 "+count+" 张牌"));
  x.tap(x.find("target","p2"));labels.length=0;r.game.players[2].count=7;
  x.accept(r,["c6"]);
  assert(labels.includes("剩余 7 张牌"));assert.equal(x.page.data.target,"p2");
  assert.equal(x.ui.layout.scroll.max,0);
});
