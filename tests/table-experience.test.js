const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../web/controller");
function room(n = 5, self = 2) {
  const players = Array.from({ length: n }, (_, i) => ({
    id: String(i),
    name: "猫" + i,
    avatar: i % 4,
    alive: true,
    count: 8,
  }));
  return {
    code: "123456",
    me: String(self % n),
    hostId: "0",
    players,
    game: {
      id: "g",
      phase: "action",
      current: String(self % n),
      remaining: 1,
      players,
      hand: [],
      deckCount: 20,
    },
  };
}
test("2–6 位玩家围同桌，自己在下方且其他座位按实际下家顺序排列", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const r = room(n);
    const v = U.derive(r, []);
    assert.equal(v.tablePlayers.length, n);
    assert(v.tablePlayers[0].isMe);
    assert.match(v.tablePlayers[0].seatStyle, /top:clamp\(52px,90%,calc\(100% - 34px\)\)/);
    for (const p of v.tablePlayers) {
      const position = p.seatStyle.match(/top:clamp\(52px,(\d+)%,calc\(100% - 34px\)\)/);
      assert(position, "每个座位都有头像安全边距");
      for (const height of [300, 310, 330]) {
        const center = Math.max(52, Math.min(height * Number(position[1]) / 100, height - 34));
        assert(center - 48 >= 4, "最高座位的头像及高亮留在牌桌内");
        assert(center + 30 <= height - 4, "最下方本人头像及高亮留在牌桌内");
      }
    }
    for (let i = 1; i < n; i++)
      assert.equal(v.tablePlayers[i].id, String((Number(r.me) + i) % n));
    assert.equal(new Set(v.tablePlayers.map((p) => p.seatStyle)).size, n);
  }
});
test("旧房间的公共与私密日志显示新名称，保留事件和原始快照", () => {
  const r = room(2, 0);
  const event = {kind: "bomb", actor: "1", cards: [{type: "bomb"}]};
  r.game.logs = [{id: 7, text: "猫1 抽到了炸弹猫", cardEvent: event}];
  r.game.privateLog = [{id: 8, text: "秘密放回炸弹猫"}];
  const before = structuredClone(r);
  const v = U.derive(r, []);
  assert.equal(v.logs[0].text, "猫1 抽到了炸毛猫咪");
  assert.equal(v.privateLog[0].text, "秘密放回炸毛猫咪");
  assert.equal(v.logs[0].id, 7);
  assert.equal(v.logs[0].cardEvent, event);
  assert.deepEqual(r, before);
  assert.deepEqual(U.motions(before, r), [], "更名不能重播旧事件");
});
test("公开组合出牌展示真实牌型、张数与出牌者，不能拿对方私密新牌", () => {
  const a = room(2, 0),
    b = structuredClone(a);
  a.game.discard = [];
  b.game.discard = [
    { id: "c1", type: "cat2" },
    { id: "c2", type: "cat2" },
  ];
  b.game.phase = "nope";
  b.game.pending = { actor: "1", type: "pair", nopeCount: 0 };
  const m = U.motion(a, b);
  assert.equal(m.card.name, "饭团猫");
  assert.equal(m.count, 2);
  assert.match(m.title, /猫1.*饭团猫.*2/);
  const hidden = structuredClone(a);
  hidden.game.players[1].count++;
  assert.equal(U.motion(a, hidden), null);
});
test("出牌展示5秒，相邻效果排队而非覆盖，无效果同步不会清空", () => {
  const seen = [],
    tasks = [];
  const player = U.createMotionPlayer({
    show: (e) => seen.push(e),
    schedule: (fn, ms) => {
      tasks.push({ fn, ms });
      return tasks.length;
    },
    cancel: () => {},
  });
  player.push({ kind: "play", title: "甲出牌" });
  player.push({ kind: "nope", title: "乙否定" });
  player.push(null);
  assert.equal(seen.length, 1);
  assert.equal(tasks[0].ms, 5000);
  tasks[0].fn();
  assert.equal(seen.at(-1).title, "乙否定");
  tasks[1].fn();
  assert.equal(seen.at(-1), null);
});
test("清理展示队列使旧定时回调失效，不能在新局展示旧牌", () => {
  const seen = [],
    tasks = [];
  const player = U.createMotionPlayer({
    show: (e) => seen.push(e),
    schedule: (fn) => {
      tasks.push(fn);
      return tasks.length;
    },
    cancel: () => {},
  });
  player.push({ kind: "draw", title: "旧私密牌" });
  player.push({ kind: "play", title: "旧出牌" });
  player.clear();
  player.push({ kind: "play", title: "新局出牌" });
  tasks[0]();
  assert.equal(seen.at(-1).title, "新局出牌");
});

test("行动描述包含真实目标头像和姓名，组合保留每种公开牌名", () => {
  const before = room(3, 0), after = structuredClone(before);
  before.game.logs = [];
  after.game.logs = [{id:1,cardEvent:{kind:"play",actor:"0",target:"2",cards:[{id:"x",type:"targetAttack"}]}}];
  const effect = U.motions(before,after)[0];
  assert.equal(effect.relationship,"猫0 向 猫2");
  assert.equal(effect.actionText,'打出「定向攻击 ×2」');
  assert.equal(effect.actor.id,"0"); assert.equal(effect.target.id,"2");
  after.game.logs[0].cardEvent.cards=[{id:"f",type:"feral"},{id:"c",type:"cat1"}];
  assert.match(U.motions(before,after)[0].actionText,/野猫.*困困猫.*2 张/);
  delete after.game.logs[0].cardEvent.target;
  assert.equal(U.motions(before,after)[0].relationship,"猫0");
});
test("旧事件缺少目标时不从后来动作猜测，私密抽牌保持短展示", () => {
  const before=room(3,0),after=structuredClone(before);before.game.logs=[];
  after.game.pending={actor:"1",target:"2",type:"favor"};
  after.game.logs=[{id:1,cardEvent:{kind:"play",actor:"0",cards:[{id:"x",type:"favor"}]}}];
  assert.equal(U.motions(before,after)[0].target,null);
  const tasks=[];const player=U.createMotionPlayer({show(){},schedule:(_,ms)=>{tasks.push(ms);return 1;}});
  player.push({kind:"draw"});assert.equal(tasks[0],1600);
});

test("旧快照进入拆弹也显示抽弹玩家，与新公开事件不重复", () => {
  const before = room(3, 0), after = structuredClone(before);
  after.game.current = "2";
  after.game.phase = "defuse";
  const fallback = U.motions(before, after);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].actor.id, "2");
  assert.equal(fallback[0].relationship, "猫2");
  assert.equal(fallback[0].explosion, true);
  after.game.logs = [{ id: 1, cardEvent: { kind: "bomb", actor: "2", cards: [{ id: "b", type: "bomb" }] } }];
  assert.equal(U.motions(before, after).length, 1);
  after.game.phase = "insert";
  after.game.bomb = { type: "imploding" };
  delete after.game.logs;
  assert.notEqual(U.motions(before, after)[0].explosion, true, "首次抽未翻面内爆猫不播放炸毛猫咪爆炸");
});

test("拆弹后秘密放回展示操作者，不把私密位置带入公开动效", () => {
  const before = room(3, 0), after = structuredClone(before);
  before.game.current = after.game.current = "2";
  before.game.phase = "defuse";
  after.game.phase = "insert";
  after.game.bomb = { type: "bomb" };
  after.game.privateLog = [{ text: "放回牌顶第 7 张" }];
  const effect = U.motions(before, after)[0];
  assert.equal(effect.kind, "defuse");
  assert.equal(effect.actor?.id, "2");
  assert.equal(effect.relationship, "猫2");
  assert.match(effect.actionText, /正在秘密放回炸毛猫咪/);
  assert.doesNotMatch(JSON.stringify(effect), /第 7 张|privateLog|position/);
});

test("获得新牌显示持牌者姓名与牌名，不拿下一位行动者当获得者", () => {
  const before = room(3, 0), after = structuredClone(before);
  after.game.current = "1";
  after.game.hand = [{ id: "new", type: "skip" }];
  const effect = U.motions(before, after)[0];
  assert.equal(effect.kind, "draw");
  assert.equal(effect.actor?.id, "0");
  assert.equal(effect.relationship, "猫0");
  assert.match(effect.actionText, /获得.*跳过/);
  assert.equal(effect.card.type, "skip");
  const observerBefore = room(3, 2), observerAfter = structuredClone(observerBefore);
  observerAfter.game.current = "1";
  observerAfter.game.players[0].count++;
  assert.equal(U.motions(observerBefore, observerAfter).length, 0, "旁观投影不能推测对手新牌内容");
});

test("预知与调整未来仅显示各自窗口，不额外排队私密提示", () => {
  for (const phase of ["future", "alterFuture"]) {
    const before = room(3, 0), after = structuredClone(before);
    after.game.phase = phase;
    after.game.future = [{ id: "private", type: "bomb" }];
    assert.equal(U.motions(before, after).length, 0);
    after.game.logs = [{ id: 1, cardEvent: { kind: "play", actor: "0", cards: [{ type: phase === "future" ? "future" : "alterFuture" }] } }];
    const effects = U.motions(before, after);
    assert.equal(effects.length, 1, "公开出牌展示仍保留");
    assert.equal(effects[0].kind, "play");
    assert.doesNotMatch(JSON.stringify(effects), /private|只有你能看见预知/);
  }
});
