const U = require("../../lib/controller");
const config = require("../../config");
Page({
  data: {
    room: null,
    v: {},
    name: "",
    avatar: 0,
    avatars: U.avatars,
    avatarStyle: U.avatars[0].style,
    selected: [],
    modal: "",
    target: "",
    named: "defuse",
    namedIndex: 0,
    namedOptions: Object.entries(U.names)
      .filter(([k]) => k !== "bomb")
      .map(([value, label]) => ({ value, label })),
    position: 1,
    positionIndex: 0,
    busy: false,
    connection: "",
    countdown: 0,
    settings: { reduced: false, sound: false },
  },
  onLoad(options) {
    this.token = wx.getStorageSync("boom.token");
    let avatar = Number(wx.getStorageSync("boom.avatar") || 0);
    this.setData({
      name: wx.getStorageSync("boom.name") || "",
      avatar,
      avatarStyle: U.avatars[avatar].style,
      settings: wx.getStorageSync("boom.settings") || {
        reduced: false,
        sound: false,
      },
    });
    this.invite = options.room;
    this.visible = true;
    this.restore();
  },
  onShow() {
    this.visible = true;
    if (this.data.room) this.poll();
    this.clock = setInterval(() => this.tick(), 250);
  },
  onHide() {
    this.visible = false;
    this.epoch = (this.epoch || 0) + 1;
    if (this.pollRequest) this.pollRequest.abort();
    clearInterval(this.clock);
  },
  onUnload() {
    this.onHide();
    clearTimeout(this.motionTimer);
    if (this.audio) this.audio.destroy();
  },
  onShareAppMessage() {
    return {
      title: this.data.room
        ? "来玩炸弹猫，房间号 " + this.data.room.code
        : "朋友局 · 和朋友轻松开一局",
      path:
        "/pages/home/home" +
        (this.data.room ? "?room=" + this.data.room.code : ""),
    };
  },
  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },
  request(path, body, long = false) {
    return new Promise((resolve, reject) => {
      const req = wx.request({
        url: config.apiBase + "/api" + path,
        method: body === undefined ? "GET" : "POST",
        data: body,
        timeout: long ? 25000 : 12000,
        header: {
          "content-type": "application/json",
          ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
        },
        success: (r) => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
          else {
            let e = Error(r.data?.message || "暂时无法完成，请重试");
            e.status = r.statusCode;
            reject(e);
          }
        },
        fail: (e) =>
          reject(
            Error(
              e.errMsg.includes("abort")
                ? "请求已暂停"
                : "网络连接失败，请检查服务是否启动",
            ),
          ),
      });
      if (long) this.pollRequest = req;
    });
  },
  async restore() {
    try {
      if (this.token) {
        const r = await this.request("/rooms/current");
        if (r) {
          this.accept(r);
          this.poll();
        }
      }
      if (this.invite && !this.data.room)
        this.setData({ modal: "join", code: this.invite });
    } catch (e) {
      if (e.status === 401) {
        this.token = null;
        wx.removeStorageSync("boom.token");
      } else this.setData({ connection: e.message });
    }
  },
  async session() {
    if (this.token) {
      await this.request("/profile", {
        name: this.data.name,
        avatar: this.data.avatar,
      });
      return;
    }
    if (!this.data.name.trim()) throw Error("先给自己起个名字吧");
    let code;
    if (!config.localMode)
      code = await new Promise((resolve, reject) =>
        wx.login({
          success: (r) =>
            r.code ? resolve(r.code) : reject(Error("微信登录失败")),
          fail: reject,
        }),
      );
    const s = await this.request("/session", {
      name: this.data.name.trim(),
      avatar: this.data.avatar,
      code,
    });
    this.token = s.token;
    wx.setStorageSync("boom.token", s.token);
    wx.setStorageSync("boom.name", this.data.name);
    wx.setStorageSync("boom.avatar", this.data.avatar);
  },
  accept(r) {
    if (!r) return;
    const old = this.data.room;
    if (old?.code === r.code && old.revision > r.revision) return;
    this.offset = r.serverNow - Date.now();
    let selected = this.data.selected.filter((id) =>
      r.game?.hand.some((c) => c.id === id),
    );
    const changed = U.contextChanged(old, r);
    const effect = U.motion(old, r);
    this.setData({
      room: r,
      selected,
      v: U.derive(r, selected),
      connection: "",
      motion: effect,
      ...(changed
        ? { modal: "", target: "", position: 1, positionIndex: 0 }
        : {}),
    });
    if (effect) {
      clearTimeout(this.motionTimer);
      this.motionTimer = setTimeout(() => this.setData({ motion: null }), 850);
      if (this.data.settings.sound) {
        this.audio ||= wx.createInnerAudioContext();
        this.audio.src = "/assets/tone.mp3";
        this.audio.play();
      }
    }
    this.tick();
  },
  tick() {
    let deadline = this.data.room?.game?.deadline;
    if (deadline)
      this.setData({
        countdown: Math.max(
          0,
          Math.ceil((deadline - Date.now() - (this.offset || 0)) / 1000),
        ),
      });
  },
  async refresh() {
    if (this.data.room) {
      try {
        this.accept(await this.request("/rooms/" + this.data.room.code));
      } catch (e) {
        this.notice(e.message);
      }
    } else await this.restore();
  },
  async poll() {
    let epoch = (this.epoch = (this.epoch || 0) + 1);
    while (this.visible && this.data.room && this.epoch === epoch) {
      try {
        const r = await this.request(
          "/rooms/" + this.data.room.code + "?after=" + this.data.room.revision,
          undefined,
          true,
        );
        if (epoch !== this.epoch) return;
        if (r && r.revision !== this.data.room.revision) this.accept(r);
        else if (this.data.connection) this.setData({ connection: "" });
      } catch (e) {
        if (epoch !== this.epoch) return;
        if ([401, 403, 404].includes(e.status)) {
          this.epoch++;
          if (e.status === 401) {
            this.token = null;
            wx.removeStorageSync("boom.token");
          }
          this.setData({ room: null, modal: "", v: {} });
          this.notice(e.message);
          return;
        }
        this.setData({ connection: "连接中断，正在重连…" });
        await new Promise((r) => setTimeout(r, 1800));
      }
    }
  },
  notice(message) {
    wx.showToast({ title: message, icon: "none", duration: 3000 });
  },
  async command(type, payload = {}) {
    if (this.data.busy || !this.data.room) return;
    this.setData({ busy: true });
    try {
      const r = await this.request(
        "/rooms/" + this.data.room.code + "/command",
        {
          commandId:
            Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
          revision: this.data.room.revision,
          gameId: this.data.room.game?.id,
          type,
          ...payload,
        },
      );
      if (type === "leave") {
        this.epoch++;
        this.setData({
          room: null,
          v: {},
          selected: [],
          modal: "",
          canResume: !!r,
        });
        return;
      }
      this.setData({ selected: [], modal: "" });
      this.accept(r);
    } catch (e) {
      if (e.status === 409) {
        await this.refresh();
        this.notice("局面已变化，请查看最新状态后再操作");
      } else this.notice(e.message);
    } finally {
      this.setData({ busy: false });
    }
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  choosePosition(e) {
    const idx = Number(e.detail.value);
    this.setData({ positionIndex: idx, position: idx + 1 });
  },
  chooseNamed(e) {
    const idx = Number(e.detail.value);
    this.setData({ namedIndex: idx, named: this.data.namedOptions[idx].value });
  },
  setting(e) {
    const settings = {
      ...this.data.settings,
      [e.currentTarget.dataset.field]: e.detail.value,
    };
    this.setData({ settings });
    wx.setStorageSync("boom.settings", settings);
  },
  async action(e) {
    const a = e.currentTarget.dataset.action,
      id = e.currentTarget.dataset.id;
    if (this.data.busy) return;
    try {
      if (
        ["settings", "rules", "profile", "join", "leave", "detail"].includes(a)
      ) {
        this.setData({ modal: a });
        return;
      }
      if (a === "close") {
        this.setData({ modal: "" });
        return;
      }
      if (a === "avatar") {
        this.setData({
          avatar: Number(id),
          avatarStyle: U.avatars[Number(id)].style,
          modal: "",
        });
        return;
      }
      if (a === "create" || a === "join-submit") {
        this.setData({ busy: true });
        await this.session();
        const r = await this.request(
          a === "create" ? "/rooms" : "/rooms/join",
          a === "create" ? {} : { code: this.data.code },
        );
        this.setData({ modal: "" });
        this.accept(r);
        this.poll();
        return;
      }
      if (a === "resume") {
        const r = await this.request("/rooms/current");
        this.setData({ canResume: false });
        if (r) {
          this.accept(r);
          this.poll();
        }
        return;
      }
      if (a === "copy") {
        wx.setClipboardData({ data: this.data.room.code });
        return;
      }
      if (a === "card") {
        let selected = this.data.selected.includes(id)
          ? this.data.selected.filter((x) => x !== id)
          : [...this.data.selected, id];
        this.setData({ selected, v: U.derive(this.data.room, selected) });
        return;
      }
      if (a === "clear") {
        this.setData({ selected: [], v: U.derive(this.data.room, []) });
        return;
      }
      if (a === "prepare") {
        this.setData({ target: "", modal: "play" });
        return;
      }
      if (a === "target") {
        this.setData({ target: id });
        return;
      }
      if (a === "play")
        return await this.command("play", {
          cards: this.data.selected,
          target: this.data.target || undefined,
          named: this.data.v.selection.needsNamed ? this.data.named : undefined,
        });
      if (a === "ready")
        return await this.command("ready", { ready: !this.data.v.ready });
      if (a === "nope")
        return await this.command("nope", {
          cardId: this.data.room.game.hand.find((c) => c.type === "nope").id,
        });
      if (a === "give")
        return await this.command("give", { cardId: this.data.selected[0] });
      if (a === "insert")
        return await this.command("insert", { position: this.data.position });
      if (a === "leave-submit") return await this.command("leave");
      if (a === "kick") {
        let yes = await new Promise((resolve) =>
          wx.showModal({
            title: "移出这位朋友？",
            content: "对方可以再次通过房间号加入。",
            success: (r) => resolve(r.confirm),
          }),
        );
        if (yes) await this.command("kick", { target: id });
        return;
      }
      if (["draw", "defuse", "closeFuture", "start", "rematch"].includes(a))
        return await this.command(a);
    } catch (e) {
      this.notice(e.message || "操作失败，请稍后再试");
    } finally {
      this.setData({ busy: false });
    }
  },
});
