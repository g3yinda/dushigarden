# 微信小游戏适配实施计划

> 使用 subagent-driven-development 执行渲染单元与独立复核；主任务负责运行入口和集成。用户已明确要求完成适配并解决新账号编译问题，视觉沿用已批准的 DESIGN.md，不重新设计。

**目标：** AppID `wxf7af6d01a9bbfdbd` 在微信开发者工具小游戏模式真实运行现有好友房与2–6人炸弹猫。

**架构：** 保留 `miniprogram/` 作为小游戏包目录，新增 `game.js`、`game.json`，项目 `compileType` 改为 `game`。页面业务定义导出供小游戏直接创建状态实例，同时保留原 Page 注册兼容旧小程序测试。复用现有控制器、wx.request、私密投影及后端规则，不在客户端新增第二套游戏引擎。Canvas重建显示、触控、滚动与动画，不使用 WebView/DOM/WXML 模拟执行。

**技术：** 原生微信小游戏 Canvas 2D、wx 键盘/触控/生命周期/分享接口；无收费或额外第三方框架。

## 1. 运行入口与状态桥接

- [x] 先新增测试证明无 Page/App/document 环境不能启动现有工程，检查入口、生命周期、键盘与邀请query。
- [x] 新增 `miniprogram/game.js` 和 `miniprogram/game.json`：竖屏、请求超时25秒、Canvas启动。
- [x] `pages/home/home.js` 导出业务定义并条件注册 Page；保留原方法与响应语义。
- [x] `lib/game-runtime.js` 创建实例，按嵌套路径应用setData、触发Canvas显示；onShow/onHide暂停恢复长轮询与计时，不重复创建clock；处理wx键盘输入、分享query与卸载。
- [x] 验证触控坐标使用逻辑px，Canvas按pixelRatio缩放；安全区避开微信胶囊，resize重排。

## 2. Canvas显示与交互

文件：`lib/canvas-ui.js`，导出 `CanvasUI`。构造参数 `{canvas, wx, page, info, onInput}`；公开 `render(now)`、`resize(info)`、`touchStart(event)`、`touchMove(event)`、`touchEnd(event)`、`needsFrame()`、`destroy()`。page.data为唯一UI状态；动作通过page.action({currentTarget:{dataset}})或原设置/选择方法传递。onInput(field)负责原生键盘。图片以wx.createImage缓存，禁止每次触控重新加载。

- [x] 首页图片优先、一屏、昵称/头像/创建/加入/恢复/说明/设置。
- [x] 建房弹框一屏全部选项；等待页两列、分享/复制/加Bot/准备/开始/踢人。
- [x] 共桌头像、牌堆、折叠横向手牌、多选/取消/展开、底部固定否定与打出/抽牌。
- [x] 目标选择头像姓名、三张点名、预知、重排、交牌、拆弹、插回、结果/再开、退出/关闭二次确认。
- [x] 保留完整退出确认、不被同步关闭；只持否定且能响应者按钮高亮；5秒公开动作与单次爆炸、减弱动态、音效。
- [x] 模态框仅命中自身；滑动不误出牌；长页与私密内容可滚动，底部操作不被覆盖。
- [x] 用真实状态和假Canvas边界验证2–6座位、320/390/430宽度、手牌横滑、目标/所有阶段命中区域及覆盖层。

## 3. 集成与开发工具验证

- [x] 修改 `tools/check.js` 检查小游戏入口/类型，保留旧页面及资源/双端控制器检查；发布检查继续拒绝调试配置。
- [x] 跑完整 npm test 和 npm run check；新测试先失败再通过。
- [x] 在新AppID的开发工具编译；实际输入昵称、建房、五Bot、准备和开始，验证折叠选牌、交牌、抽牌、拆弹/放回和退出；否定、其余出牌及特殊阶段另由画布触控与规则/HTTP自动测试覆盖，不宣称全部在模拟器人工执行。
- [x] 验证小屏与六人局；保留截图证据，区分模拟器与真实iPhone、调试与正式发布。
- [x] 独立规格复核后代码质量复核，修复所有影响运行的发现；最终回归。

## 4. 文档与交付

- [x] 更新 README、DESIGN、当前索引、运行/发布状态与验收，注明当前入口是小游戏，旧WXML作为兼容基线保留。
- [x] 上传密钥仅本机读取、Git忽略，不把上传适配等同正式审核；本次不绕过备案/域名/真实登录条件。
- [x] 只提交本次代码/文档，不混入用户未追踪封面或密钥；保留公网后端数据。

官方参考：微信团队 [小游戏示例](https://github.com/wechat-miniprogram/minigame-demo) 中 game.js/game.json 结构与 [小游戏 API 类型](https://github.com/wechat-miniprogram/minigame-api-typings)。
