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

test("enlarged compact six-player labels do not overlap the local player's avatar", () => {
  const x = harness(320, 568); x.accept(room());
  const own = x.ui.layout.seats.find(s => s.isMe);
  for (const seat of x.ui.layout.seats.filter(s => !s.isMe)) {
    const label = { x: seat.x, y: seat.y + seat.h - 16, w: seat.w, h: 16 };
    assert(label.x + label.w <= own.x - 2 || label.x >= own.x + own.h + 2 || label.y + label.h <= own.y - 2 || label.y >= own.y + own.h + 2, "other-player labels must clear the local avatar and its ring");
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

test("hand drag ends at the last visible folded card without a blank trailing section", () => {
  for(const [w,h] of [[320,568],[390,844],[430,932]])for(const count of [1,4,8,35]) {
    const x=harness(w,h),r=room(6,"action",Array.from({length:count},()=>"cat2")),boxes=[],box=x.ui.box.bind(x.ui);
    x.ui.box=(...a)=>{boxes.push(a);return box(...a);};x.accept(r);
    const hand=x.ui.layout.hand,p={clientX:hand.x+hand.w/2,clientY:hand.y+20};
    x.ui.touchStart({touches:[p]});
    x.ui.touchMove({touches:[{clientX:p.clientX-3000,clientY:p.clientY}]});
    x.ui.touchEnd({changedTouches:[{clientX:p.clientX-3000,clientY:p.clientY}]});
    x.ui.render(1000);
    const last=x.find("card","c"+(count-1)),face=x.ui.layout.hand.faces.at(-1);
    assert.equal(last.w,44,"last folded card has only its visible strip, not an empty body extension");
    assert.equal(x.ui.layout.hand.offset,x.ui.layout.hand.max);
    const edge=Math.min(hand.x+hand.w,hand.x+count*44);
    assert.equal(last.x+last.w,edge,"last card reaches the viewport edge exactly when scrolling is needed");
    assert.equal(face.art.x+face.art.w+4,edge,"art strip finishes with only normal card padding");
    const painted=boxes.filter(a=>a[0]===last.x&&a[1]===last.y&&a[5]==="#e3e3e8").at(-1);
    assert.equal(painted?.[2],44,"rounded card border ends at the same boundary");
    const offset=x.ui.handOffset;
    x.ui.touchStart({touches:[p]});x.ui.touchMove({touches:[{clientX:p.clientX-200,clientY:p.clientY}]});
    x.ui.touchEnd({changedTouches:[{clientX:p.clientX-200,clientY:p.clientY}]});
    assert.equal(x.ui.handOffset,offset,"continued dragging cannot reveal empty space");
    assert.equal(x.page.data.selected.length,0,"a drag does not select a card");
  }
});

test("hand end remains correct after selecting, expanding, clearing and removing its last card", () => {
  const x=harness(),r=room(6,"action",Array.from({length:8},()=>"cat2"));
  for(const [selected,expanded] of [[["c7"],false],[["c2","c7"],false],[["c2"],false],[[],true],[[],false]]) {
    x.page.data.handExpanded=expanded;x.accept(r,selected);x.ui.handOffset=10000;x.ui.render(1000);
    const hand=x.ui.layout.hand,last=x.find("card","c7");
    assert(last,JSON.stringify({selected,expanded,hand}));
    assert.equal(last.x+last.w,hand.x+Math.min(hand.w,hand.total),"expanded and selected last cards end at their full face boundary");
    if(!expanded&&!selected.includes("c7"))assert.equal(last.w,44);
    else assert(last.w>44,"full face remains available");
  }
  r.game.hand.pop();x.ui.handOffset=10000;x.accept(r);
  assert.equal(x.ui.layout.hand.offset,x.ui.layout.hand.max,"snapshot removal clamps stale scroll offset");
  const last=x.find("card","c6");
  assert.equal(last.x+last.w,Math.min(x.ui.layout.hand.x+x.ui.layout.hand.w,x.ui.layout.hand.x+7*44));
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
  assert.equal(x.ui.layout.explosion, null, "reduced motion has no full-screen particles");
  x.ui.destroy();
  assert.equal(x.ui.needsFrame(), false);
});

test("bomb animation spans the complete viewport and its shockwave reaches the farthest corner", () => {
  for (const [w, h] of [[320,568], [390,844], [430,932]]) {
    const x = harness(w,h); x.accept(room());
    const washes = [];
    x.ui.ctx.fillRect = (...rect) => { if (x.ui.ctx.fillStyle === "#ff7768") washes.push(rect); };
    x.page.data.motionItems = [{ renderId: 1, kind: "bomb", explosion: true, actor: x.page.data.v.players[0], title: "抽到了炸弹猫！", card: U.card({type:"bomb"}) }];
    x.ui.render(1000); x.ui.render(1500);
    const fx = x.ui.layout.explosion;
    assert(fx?.active, "explosion is visible throughout its richer sequence");
    assert.deepEqual(fx.viewport, { x: 0, y: 0, w, h });
    assert(washes.some(rect => rect[0] === 0 && rect[1] === 0 && rect[2] === w && rect[3] === h), "the effect paints across the full canvas rather than only the table");
    x.ui.render(2800);
    assert(x.ui.layout.explosion.outerRadius >= Math.hypot(w / 2, Math.max(x.ui.layout.explosion.origin.y, h - x.ui.layout.explosion.origin.y)), "shockwave expands beyond every screen corner");
    x.ui.render(3900);
    assert.equal(x.ui.layout.explosion, null, "full-screen effect clears while the five-second notice remains");
    assert.equal(x.ui.layout.motion.duration, 5000);
  }
});

test("full-screen explosion preserves the private defuse dialog and its live touch controls", () => {
  const x = harness(320,568), r = room(6,"defuse"); x.accept(r);
  const before = {...x.find("defuse")};
  x.page.data.motionItems = [{ renderId: 1, kind: "bomb", explosion: true, actor: x.page.data.v.players[0], title: "抽到了炸弹猫！", card: U.card({type:"bomb"}) }];
  x.ui.render(1000); x.ui.render(1400);
  assert.deepEqual(x.ui.layout.explosion?.protectedRect, x.ui.layout.modalRect, "foreground effects leave the complete choice dialog clear");
  assert.deepEqual(x.find("defuse"), before);
  x.tap(x.find("defuse"));
  assert.equal(x.calls.at(-1).action, "defuse");
  x.page.data.motionItems = [{ renderId: 2, kind:"bomb", title:"首次抽到内爆猫 · 翻面插回", card:U.card({type:"imploding"}) }];
  x.ui.render(1600);
  assert.equal(x.ui.layout.explosion, null, "unflipped imploding card does not falsely trigger the bomb blast");
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
  assert.equal(created, 5);
  im.onload();
  assert.equal(invalidated, 1);
  assert(ui.needsFrame());
  ui.render(10);
  assert.equal(ui.needsFrame(), false);
  ui.render(11);
  assert.equal(created, 5);
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
  for (let n = 2; n <= 6; n++) for (const warning of [null, "deckTop", "deckBottom"]) {
    labels.length = 0;
    const r = room(n);
    if (warning) r.game[warning] = { type: "imploding", faceUp: true };
    x.accept(r);
    const me = x.ui.layout.seats.find(s => s.isMe);
    for (const label of labels.filter(a => a[5] === "center" && /^(剩余 \d+ 张|\d+ 张|弃牌堆|牌[顶底]有内爆猫)$/.test(a[0])))
      assert(label[2] + label[3] / 2 <= me.y - 3, `deck label ${label[2]} clears avatar ${me.y} for ${n} seats`);
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
    const labels = [], boxes = [], text = x.ui.text.bind(x.ui), box = x.ui.box.bind(x.ui);
    x.ui.text = (...args) => { labels.push(args); return text(...args); };
    x.ui.box = (...args) => { boxes.push(args); return box(...args); };
    const handY=x.ui.layout.hand.y;
    const r=room(6,"favor");r.game.pending.actor="p1";
    x.accept(r,["c0"]);
    assert.equal(x.ui.layout.modal, "");
    assert.equal(x.ui.layout.privatePanel, null);
    assert.equal(x.ui.layout.hand.y,handY);
    assert.equal(x.ui.layout.hand.giving,true);
    const hint = labels.find(a => a[0].includes("索要 1 张")), frame = boxes.find(a => a[5] === "#0071e3" && a[6] === 18);
    assert.equal(hint[1], w / 2);
    assert.equal(hint[5], "center");
    assert(hint[2] + hint[3] / 2 <= frame[1] + frame[3] - 4, "hint has bottom padding inside the hand frame");
    assert(hint[7] <= frame[2] - 24, "hint has horizontal padding inside the hand frame");
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

test("cozy table keeps seats clear of both piles across 2–6 players and phone proportions", () => {
  const overlaps = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  for (const [w,h] of [[320,568],[360,640],[375,667],[390,844],[430,932]]) {
    const x=harness(w,h);
    for(let n=2;n<=6;n++) {
      x.accept(room(n));
      assert.equal(x.ui.layout.piles?.length,2,"real deck/discard geometry is exposed for visibility checks");
      for(const pile of x.ui.layout.piles) for(const seat of x.ui.layout.seats)
        assert(!overlaps(pile,seat),`${w}x${h}, ${n} players: ${JSON.stringify(pile)} covers ${JSON.stringify(seat)}`);
      for(let i=0;i<x.ui.layout.seats.length;i++) for(let j=i+1;j<x.ui.layout.seats.length;j++)
        assert(!overlaps(x.ui.layout.seats[i],x.ui.layout.seats[j]),`${w}x${h}, ${n} players: ${JSON.stringify(x.ui.layout.seats[i])} overlaps ${JSON.stringify(x.ui.layout.seats[j])}`);
      assert.equal(x.ui.layout.scroll.max,0);
      assert(x.ui.layout.hand.y+x.ui.layout.hand.h <= x.ui.layout.dock.y-6);
    }
  }
});

test("local avatar and both painted text lines form one horizontally centered group", () => {
  for(const [w,h] of [[320,568],[360,640],[390,688],[390,844],[430,932]])for(let n=2;n<=6;n++)for(const name of ["小白","小白和朋友一起玩的超长昵称abcdefgh"])for(const phase of ["action","nope"]) {
    const x=harness(w,h),r=room(n,phase),labels=[];
    let portrait;const avatar=x.ui.avatar.bind(x.ui);
    x.ui.avatar=(p,ax,ay,size,...rest)=>{if(p.isMe)portrait={x:ax,y:ay,size};return avatar(p,ax,ay,size,...rest);};
    x.ui.ctx.fillText=(text,tx,ty)=>labels.push({text,x:tx,y:ty,w:x.ui.ctx.measureText(text).width});
    r.players[0].name=name;r.players[0].count=35;x.accept(r);
    const lines=labels.filter(a=>Math.abs(a.x-(portrait.x+portrait.size+8))<1e-6&&(Math.abs(a.y-(portrait.y+portrait.size*.36))<1e-6||Math.abs(a.y-(portrait.y+portrait.size*.72))<1e-6));
    assert.equal(lines.length,2);
    const right=Math.max(...lines.map(a=>a.x+a.w));
    assert(Math.abs((portrait.x+right)/2-w/2)<.01,`${w}x${h}, ${n} seats, ${name}, ${phase}: group center ${(portrait.x+right)/2} differs from table center ${w/2}`);
    const seat=x.ui.layout.seats.find(s=>s.isMe);
    assert(Math.abs(seat.x-portrait.x)<.01&&Math.abs(seat.x+seat.w-right)<.01,"seat geometry covers the actually painted avatar and labels");
    assert(portrait.x>=x.ui.layout.table.x&&right<=x.ui.layout.table.x+x.ui.layout.table.w);
  }
});

test("folded hand exposes names, illustrations and paws instead of vertical names only", () => {
  for(const [w,h] of [[320,568],[390,844],[430,932]]) {
    const x=harness(w,h),labels=[],arts=[];
    const text=x.ui.text.bind(x.ui),cardArt=x.ui.cardArt.bind(x.ui);
    x.ui.text=(...a)=>{labels.push(a);return text(...a);};
    x.ui.cardArt=(...a)=>{arts.push(a);return cardArt(...a);};
    x.accept(room(6,"action",["defuse","nope","cat1","favor","targetAttack","bottom"]));
    const hand=x.ui.layout.hand;
    assert.equal(hand.style,"illustrated-fold");
    const first=x.find("card","c0");
    assert(first.w>=44 && first.h>=44);
    assert(labels.some(a=>a[0]==="拆弹" && a[1] >= first.x && a[1] <= first.x+first.w && a[2]>=hand.y));
    assert(arts.some(a=>a[0].id==="c0" && a[2]>=hand.y && a[4]>=20),"visible strip contains an illustration");
    assert(hand.faces.every(f=>f.art.y+f.art.h<=f.paw.y-f.paw.size/2 && f.paw.y+f.paw.size/2<=hand.y+hand.h));
    const before=hand.y;
    x.tap(first);x.tap(x.find("hand-toggle"));
    assert.equal(x.ui.layout.hand.y,before);
    assert.deepEqual(Array.from(x.page.data.selected),["c0"]);
    x.tap(x.find("clear"));
    assert(x.page.data.handExpanded);
  }
});

test("cozy background is cached through card selection and falls back without blocking play", () => {
  const x=harness();x.accept(room());
  assert(x.images.some(im=>im.path==="assets/cozy-room-v1.jpg"));
  const count=x.images.length;
  x.tap(x.find("card","c0"));assert.equal(x.images.length,count);
  const entry=x.ui.images.get("cozy-room-v1.jpg");entry.ready=false;entry.error=true;
  x.ui.render(1000);
  assert(x.find("draw") && x.ui.layout.seats.length===6);
});

test("tall capsule and bottom safe area leave the table and fixed operations on one screen", () => {
  for(const [w,h] of [[320,568],[360,640],[390,844],[430,932]]) {
    const x=harness(w,h);
    x.ui.resize({windowWidth:w,windowHeight:h,pixelRatio:3,statusBarHeight:44,menu:{bottom:94},safeArea:{bottom:h-34}});
    x.accept(room());
    const {table,hand,dock,seats,piles}=x.ui.layout;
    assert(table.y>=102 && table.y+table.h<hand.y);
    assert(hand.y+hand.h<=dock.y-6);
    for(const a of ["prepare","draw","nope-pass","nope-response"]) {
      const r=x.find(a);assert(r.h>=44 && r.y+r.h<=h-34);
    }
    for(const s of seats)assert(s.y>=table.y&&s.y+s.h<=table.y+table.h);
    for(const pile of piles)for(const s of seats)
      assert(pile.x+pile.w<=s.x||pile.x>=s.x+s.w||pile.y+pile.h<=s.y||pile.y>=s.y+s.h);
    assert.equal(x.ui.layout.scroll.max,0);
  }
});

test("public imploding warnings live beside the deck and clear the local portrait", () => {
  for(const [w,h] of [[320,568],[390,844],[430,932]])for(const warning of ["deckTop","deckBottom"]) {
    const x=harness(w,h),labels=[],text=x.ui.text.bind(x.ui);
    x.ui.text=(...a)=>{labels.push(a);return text(...a);};
    const r=room();r.game[warning]={type:"imploding",faceUp:true};x.accept(r);
    const me=x.ui.layout.seats.find(s=>s.isMe);
    const warnings=labels.filter(a=>a[0].includes("有内爆猫")||a[0].includes("有翻面内爆猫"));
    assert.equal(warnings.length,1,"avoid duplicate danger text over the local avatar");
    assert(warnings[0][2]+warnings[0][3]/2<=me.y-3);
  }
});

test("cute card back stays cached and its fallback leaves the deck count and controls readable", () => {
  const x=harness();x.accept(room());
  const entry=x.ui.images.get("card-back-pink-v1.jpg");
  assert(entry?.ready,"deck loads its own decorative back asset");
  assert(x.draws.some(a=>a[0].path==="assets/card-back-pink-v1.jpg"));
  const loaded=x.images.length;x.tap(x.find("card","c0"));
  assert.equal(x.images.length,loaded,"selection must not reload the back or avatars");
  entry.ready=false;entry.error=true;const labels=[],text=x.ui.text.bind(x.ui);
  x.ui.text=(...a)=>{labels.push(a);return text(...a);};x.ui.render(1000);
  assert(labels.some(a=>a[0]==="剩余 20 张"));assert(x.find("draw"));
});

test("deck count has a small visible gap and clears the next warning and player across phone sizes", () => {
  for(const [w,h] of [[320,568],[360,640],[375,667],[390,688],[390,708],[390,728],[390,748],[390,844],[430,932]])for(const warning of [null,"deckTop","deckBottom"]) {
    const x=harness(w,h),r=room(),labels=[],text=x.ui.text.bind(x.ui);
    if(warning)r.game[warning]={type:"imploding",faceUp:true};
    x.ui.text=(...a)=>{labels.push(a);return text(...a);};x.accept(r);
    const count=labels.find(a=>/^剩余 \d+ 张$/.test(a[0])),deck=x.ui.layout.piles[0],me=x.ui.layout.seats.find(s=>s.isMe);
    assert(count,"remaining count stays outside the illustrated deck on supported portrait screens");
    assert(count[2]-count[3]/2>=deck.y+deck.h+3,`${w}x${h}: count clears the stack`);
    assert(count[2]+count[3]/2<=me.y-3,"count clears local avatar");
    const danger=labels.find(a=>a[0].includes("有内爆猫"));
    if(danger) {
      assert(count[2]+count[3]/2<=danger[2]-danger[3]/2,"count and warning do not overlap");
      assert(danger[2]+danger[3]/2<=me.y-3,"warning clears local avatar");
    }
  }
});

test("a wider turn ring follows the active opponent and disappears when the game finishes", () => {
  for(const [w,h] of [[320,568],[390,844]]) {
    const x=harness(w,h),r=room(),arcs=[],rings=[],c=x.ui.ctx;
    c.arc=(...a)=>arcs.push(a);c.stroke=()=>{if(c.strokeStyle==="#0071e3"&&c.lineWidth>=4)rings.push({arc:arcs.at(-1),width:c.lineWidth});};
    r.game.current="p3";x.accept(r);
    assert.equal(rings.length,1);const seat=x.ui.layout.seats.find(s=>s.id==="p3"),ring=rings[0],a=ring.arc;
    assert(a[0]-a[2]-ring.width/2>=seat.x && a[0]+a[2]+ring.width/2<=seat.x+seat.w);
    assert(a[1]-a[2]-ring.width/2>=seat.y,"highlight stays inside avatar footprint");
    rings.length=0;r.game.phase="finished";x.accept(r);assert.equal(rings.length,0);
  }
});

test('十个动物头像及微信入口在五种手机尺寸下一屏显示，点击目标44px且不重叠',()=>{
  for(const [w,h] of [[320,412],[320,568],[360,640],[390,844],[430,932]]) {
    const x=harness(w,h);x.page.data.modal='profile';x.ui.render(1000);
    const regions=x.ui.layout.regions.filter(r=>r.action==='avatar');assert.equal(regions.length,10);
    assert.equal(x.ui.layout.scroll.max,0);
    const button=x.ui.layout.regions.find(r=>r.action==='wechat-avatar');assert(button&&button.h>=44);
    for(const r of regions){assert(r.w>=44&&r.h>=44);assert(r.y>=x.ui.layout.modalRect.y+48);assert(r.y+r.h<=button.y);}
    assert(button.y+button.h<=x.ui.layout.modalRect.y+x.ui.layout.modalRect.h-8);
    assert.deepEqual(x.ui.layout.wechatAvatarButton,{x:button.x,y:button.y,w:button.w,h:button.h});
  }
});
test('新动物图集和微信头像按来源缓存，重复点击不闪烁，失败回退猫咪',()=>{
  const x=harness();x.page.data.avatar=9;x.page.data.avatarStyle=U.avatarInfo({avatar:9}).avatarStyle;
  x.ui.render(1000);assert(x.images.some(i=>i.path==='assets/pets-v1.jpg'));
  const url='https://wx.qlogo.cn/mmopen/x/132';x.page.data.avatarUrl=url;x.ui.render(1000);x.ui.render(1000);
  assert.equal(x.images.filter(i=>i.path===url).length,1);
  x.images.find(i=>i.path===url).onerror();assert.doesNotThrow(()=>x.ui.render(1000));
});
