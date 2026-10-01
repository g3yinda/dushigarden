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
    assert.match(v.tablePlayers[0].seatStyle, /top:90%/);
    for (let i = 1; i < n; i++)
      assert.equal(v.tablePlayers[i].id, String((Number(r.me) + i) % n));
    assert.equal(new Set(v.tablePlayers.map((p) => p.seatStyle)).size, n);
  }
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
