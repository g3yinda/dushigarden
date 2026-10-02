# 出牌展示与常驻否定栏 Implementation Plan

> 历史材料：本文件保留当时的设计、计划或验收，不作为当前行为说明。当前规则、UI、交付和待办见 [v0.9.5 当前状态](../../00-当前状态与文档索引.md)。

> **For agentic workers:** 按任务顺序执行，沿用已批准的v3设计稿和现有共享控制器。以checkbox记录验证。

**Goal:** 用户已批准v3：每张公开行动展示5秒，姓名约23px/700，固定紧凑否定栏含缩短进度与剩余秒数。

**Architecture:** 两端共享控制器生成公开行动的出牌者/目标及分层文字；保留原串行动画队列。`nopeResponse`继续负责响应权限，新`nopePanel`给出常驻展示状态，时间源为服务器deadline，客户端不改变游戏规则。

**Tech Stack:** Node.js24、node:test、原生小程序WXML/WXSS、浏览器HTML/CSS。

## 1. 共享数据与失败回归
- [x] 修改`tests/table-experience.test.js`公开行动队列断言为5000ms，覆盖连续展示与清理；私密抽牌/预知仍1600ms。
- [x] 在`tests/frontend.test.js`增加常驻闲置、15/10/5秒进度、响应后归零/灰态、无否定但可确认不出、旁观/截止/反否定重置及两端渲染回归。
- [x] 在`test/engine.test.js`验证公开cardEvent只加入真实目标id，不携带未出的手牌；控制器合并快照仍保留原目标。
- [x] 执行`node --test tests/table-experience.test.js tests/frontend.test.js test/engine.test.js`，确认新断言因未实现而失败。

## 2. 实现与针对验证
- [x] `server/engine.js`：play事件target为指定目标，普通attack使用实际行动方向下家；Nope事件以原动作发起人为展示目标，规则和截止时间不改。
- [x] `web/controller.js`并同步`miniprogram/lib/controller.js`：公开motion返回`actor/target/relationship/actionText`，无目标只用出牌者；历史事件不猜测错误目标，组合显示实际各牌名及张数。队列公开行动5000ms；`nopePanel`非响应期返回灰态，已响应progress=0。
- [x] `web/app.js/style.css`和`miniprogram/pages/home/home.js/wxml/wxss`：行动文字与头像置于牌面上方，卡片定位共同牌桌中央；0.5秒入场/4.2秒停留/0.3秒淡出；普通同步不重播动画。否定栏左侧标题与细条+剩余字样，右侧两个44px触控胶囊，约56px高，始终保留禁用选项。
- [x] 执行上述针对测试，再执行`npm test`与`npm run check`；最后3秒保持原暖红提醒，减少动态保留5秒静态展示。

## 3. 验收与交付
- [x] 浏览器390/320px确认常驻、剩余秒数与进度、已响应灰态、目标姓名及连续5秒动效；微信工具重新编译确认原生布局。保存实际截图，不把合成牌序当随机规则证明。
- [x] 更新`DESIGN.md`、README、docs/08验收及公开测试版本说明；版本v0.6.0。更新已授权腾讯云preview时保留访问码/数据卷/隧道和回滚容器。
- [x] 完整测试、资源及差异检查通过后提交授权GitHub，生成新iOS真机调试包；手机实测和正式审核发布保持待验证。

验收结果：225项全量测试通过，两端实际UI及公网接口通过；最终原生定向攻击自动回桌截图已保存。微信iOS调试包1641 KB、非局域网，手机本人实测及正式发布保持待验证。Git提交/推送在本计划与其他交付文档保存后执行，结果由最终交付记录确认。
