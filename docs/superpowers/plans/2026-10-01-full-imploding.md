# 完整内爆猫六人版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 用户已确认六人新局使用基础版＋完整20张内爆猫扩展，2–5人继续基础版。

**Architecture:** 保留现有权威服务器状态机及两端共享控制器；根据新局人数生成牌库。现存快照保持原rulesVersion及原牌库。扩展的私密信息通过已有project投影隔离，Nope先结算再执行扩展效果。

**Tech Stack:** Node.js 24、node:test、原生微信小程序、浏览器验证客户端。

## 固定接口及规则

- 六个牌型：imploding×1、targetAttack×3、reverse×4、bottom×4、alterFuture×4、feral×4。扩展字段expansion:true。
- 新六人rulesVersion：ek-imploding-2023-online-v1。2–5使用ek-original-2025-online-v1；历史六人ek-original-2025-friends-6p-v1保留。
- six setup: 76总张数，6×8手牌，28抽牌堆，4bomb+1imploding；普通猫只cat1..cat5；feral只替代普通猫。
- direction为1或-1（旧快照缺省1）；反转只结束一个剩余回合，两人存活时按跳过处理。
- targetAttack可指定任何存活玩家包括自己，受攻击转移remaining+2，否则2。
- bottom通过Nope后draw从deck末尾，正常或危险牌流程共用draw。
- imploding首次抽到设置faceUp:true并进入insert，不消耗拆弹；再次抽到直接淘汰。插回位置私密；faceUp牌顶/牌底才公开。
- project新增rulesVersion、direction、deckTop/deckBottom（只有faceUp imploding，其他为null，绝不暴露完整牌堆）。bomb携带待放回的危险牌。
- alterFuture通过Nope进入alterFuture阶段，project.future仅当前操作者可见。command {type:'orderFuture',order:[cardIds]}要求恰好完整排列这最多三张牌；成功后回action，超时保持原顺序。不限时配置适用。
- 同名2/3张原规则继续；含feral的组合必须其余牌全部为一种普通猫或全feral。三张点名排除bomb/imploding，基础版排除扩展牌。
- 两端选人弹层targetAttack允许自己、手牌为空的玩家；原索要/对子仍需其他玩家有牌，三张只需其他玩家存活。
- 手牌折叠、出牌停留、固定否定栏、选择不出后锁定及10秒默认均保留。

## Task 1：规则引擎（shared/cards.js、server/engine.js、test/imploding.test.js）
- [x] 保存旧六人合成快照到test/fixtures/legacy-six-game.json，确保升级后可以继续抽牌。
- [x] 编写并运行失败测试：`node --test test/imploding.test.js`，覆盖牌数、首抽/再抽内爆、公开边界、反转债务、定向攻击自己/叠加、牌底危险牌、重排非法排列/隐私/超时、野猫混搭限制、旧快照。
- [x] 增加BASE_TYPES/EXPANSION_TYPES及组合验证函数；新局仅六人加入扩展。
- [x] 增加共用淘汰及抽牌方向分支，保留卡牌守恒；完善resolve、command、tick、project。
- [x] 验证2–5现有发动牌及否定回归，执行`node --test test/imploding.test.js test/engine.test.js test/six-player.test.js`。

## Task 2：两端交互（web/controller.js、web/app.js、web/style.css、miniprogram/lib/controller.js、miniprogram/pages/home/*、tests/imploding-ui.test.js）
- [x] 阅读已批准Apple设计规范，保持视觉体系；为新增交互先写选择/投影测试并确认失败。
- [x] 补全六张牌名、清晰作用说明和符号；两端控制器保持一致。
- [x] 私密重排提供上下移动和明确确认；非法/过期顺序由服务器拒绝，客户端不泄露对手牌。
- [x] 插回弹层区分内爆猫和已拆炸弹；桌面展示方向、公开翻面内爆牌顶/底提示；定向攻击居中选头像姓名含自己。
- [x] 验证无计时、Nope固定栏、默认折叠及出牌停留，执行`node --test tests/*.test.js`。

## Task 3：Bot和完整回归（server/bots.js、test/bots.test.js、test/simulation.test.js、test/public-preview.test.js）
- [x] 编写失败测试：扩展行动牌、野猫组合、私密重排、翻面内爆保留与危险牌应对。
- [x] Bot只使用project结果，不读取隐藏牌库；支持orderFuture及所有新增牌，避免以旧阶段卡死。
- [x] 随机模拟覆盖全部六人扩展及2–5回归；更新开局牌库断言为28，仅更新真实已改变的期望。
- [x] 执行`npm test`及`npm run check`，修复真实问题；检查旧快照兼容。

## Task 4：交付
- [x] 更新docs/02规则、docs/06决策及docs/08验收及README版本和扩展范围；保留审计历史并注明用户最终选择完整扩展。
- [x] 使用浏览器/微信开发者工具验收新增界面，记录实际执行范围；手机扫码由用户验证，不冒称已完成。
- [x] 备份腾讯云preview快照，构建0.5.0镜像，复用既有数据卷及运行中的公网隧道；API验证6人新牌库、投影和关闭测试房间。
- [x] 提交代码至授权GitHub main并打v0.5.0标签；正式小程序发布仍依赖备案、合法域名和游戏类目确认，不能把preview称为正式发布。

验证：最终215项自动测试与资源检查通过；浏览器合成扩展流程、原生公网六人开局/抽牌底与房主关闭、公网API新牌库已实际执行。手机实测与微信正式发布作为发布条件保留，未计为本轮完成。
