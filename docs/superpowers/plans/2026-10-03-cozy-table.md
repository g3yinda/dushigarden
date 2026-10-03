# 温暖牌桌实施计划

**Goal:** 将用户批准的房间配景、奶油桌面和图文猫爪折叠牌落实为响应式小游戏。

**Architecture:** CanvasUI 保留状态与触控；新 cozy-table-ui 模块负责场景、座位/牌堆几何与装饰绘制，折叠牌复用现有卡牌图集。独立背景缓存，动态文字不烘焙到图片。

**Tech Stack:** 微信 Canvas2D、Node test、既有图集、GPT image_gen。

## 任务

- [x] 1. 在 tests/minigame-canvas.test.js 增加不同屏幕/2–6人下牌堆避让座位的回归，以及折叠图文牌可识别、触控/横滑/展开不丢选择的验收；先运行 node --test tests/minigame-canvas.test.js 确认新断言失败。
- [x] 2. 新建 miniprogram/lib/cozy-table-ui.js：drawBackdrop(ui) 裁切缓存背景，drawBoard(ui,y,h) 动态椭圆/围坐/牌堆，drawFoldedCard(ui,card,x,y,w,h,exposed) 名称+插画+猫爪。canvas-ui.js 调用新模块，固定手牌区从屏幕剩余高度分配，保留所有现有选择与模态业务入口。
- [x] 3. 原始 GPT 背景与提示词保存 assets/design/v0.10.8，运行版 miniprogram/assets/cozy-room-v1.jpg 压至约60–100KB；加载失败保持奶油底，图片不每次点击重建。
- [x] 4. 用生产 Canvas 在 output/acceptance-v0.10.8 渲染320×568、360×640、375×667、390×844、430×932，覆盖2–6人、长手牌、选牌、展开、索要、否定、预知、目标、拆弹及安全区；查看实际图片修正碰撞，不仅验证布局数字。
- [x] 5. 运行 npm test、npm run check、git diff --check；更新 package.json 到0.10.8及当前设计、需求、验收和状态索引，记录已做与真机待验收边界。交付截图与本地修改，不默认正式发布。
