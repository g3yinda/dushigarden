# 游戏选择弹框 Implementation Plan

> **For agentic workers:** 执行既有用户授权的界面维护，任务内直接实施与复核；遵循测试先失败后修复和verification-before-completion。

**Goal:** 交牌仅提示手牌，其他对局选择独立弹框，一屏完成、不纵向滚动。

**Architecture:** 保留Canvas固定分区及共享业务；game-choice-ui独立负责阶段弹框和出牌目标/点名。阶段弹框从当前本人阶段派生，显式退出确认优先；交牌不建立弹层。长枚举改位置步进/快捷位置和弹框内分页点名，继续调用已有choosePosition/chooseNamed/命令。

**Tech Stack:** 原生Canvas2D、CommonJS、Node test、微信开发工具。

- [x] tests/minigame-canvas.test.js：320×568、390×844、430×932与320×412，交牌不遮桌/可操作手牌；私密阶段全部按钮在弹框内且无需滚动。先运行并确认失败。
- [x] miniprogram/lib/canvas-ui.js、game-choice-ui.js：去除桌内面板；交牌短提示/手牌轮廓与底部交牌；选择弹框完整呈现、位置步进与顶部/底部/随机、三张组合在同一弹框选目标及分页点名。显式退出优先，状态变动自动替换阶段；修复旧回归以对应新要求。
- [x] 运行Canvas与全部npm test、npm run check、diff检查；原生模拟器或原生渲染截图检查交牌和小屏私密弹框，记录实际范围。
- [x] DESIGN/README/当前状态/设计任务/验收同步v0.10.2；排除密钥及用户品牌文件，推送现有GitHub PR。

验证结果：新增10项Canvas回归（总53项），完整493项通过，check/diff检查通过。28张独立生产Canvas渲染图与微信编译0错误；真实手机触控仍待扫码，不把合成画面当真机验收。
