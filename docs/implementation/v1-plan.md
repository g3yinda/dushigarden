# 第一版实施计划

2026-09-30，用户确认 v0.3 风格并明确授权开发。已有 AppID，尚无后端。采用现有 PRD 和规则配置作为首版基线，不重复设计评审。

## 架构与交付

微信原生 WXML/WXSS/JavaScript 小程序；Node.js 24 权威服务、JSON 原子快照；零服务端第三方依赖。HTTP 长轮询同步，服务器裁决倒计时；微信登录换取服务器会话。仅本地开放开发身份。附同服务的浏览器体验端，方便未配置微信工具时验收，不能代替微信真机验收。

## 顺序

- [x] 规则测试先行：2–5 人开局计数、攻击余债、否定、组合、拆弹、私密投影、超时与守恒。
- [x] 实现 server/engine.js 与 shared/cards.js；用独立随机源与时钟可复现测试。
- [x] 实现 server/rooms.js 和 server/index.js：身份、准备、开始、退出托管、重开、持久化、长轮询、去重和过期命令拒绝；HTTP 行为测试。
- [x] 实现 miniprogram/ 原生页面及 web/ 可交互预览：大厅、房间、规则、桌面、详情、目标、私密阶段、结算、分享、设置。
- [x] 本地多客户端联机、100 局自动完整对局、规则和网络测试、手机宽度视觉检查、资源与配置检查。
- [x] 记录已实现范围、运行部署办法与 AppID/域名/微信真机待验证项。
- [ ] 公网 HTTPS 后端、真实微信登录与分享、2–5 台设备朋友试玩、弱网与性能验收、微信审核发布。

GitHub 尚未提供，不创建远程、不上传或发布。当前目录无 Git 仓库，直接在用户指定项目目录实现并保留原设计文档。

## 客户端契约

POST /api/session {name,avatar,code?} => {token,player:{id,name,avatar},mode:'local'|'wechat'}。local 仅服务器显式开发模式开放。会话 token 用 Authorization: Bearer。
POST /api/profile {name,avatar} 更新本人的昵称头像；对局进行中禁止修改。
POST /api/rooms {} 创建；POST /api/rooms/join {code} 加入；GET /api/rooms/current 恢复当前房。
GET /api/rooms/:code?after=revision 长轮询至变更或20秒，返回投影房间。
POST /api/rooms/:code/command {commandId,revision,gameId?,type,...payload} => 投影房间。
房间命令 ready {ready}, start, leave, kick {target}, rematch。游戏命令 play {cards:[instanceId],target?,named?}, draw, nope {cardId}, defuse, insert {position:1-based}, give {cardId}, closeFuture。
错误 JSON {error,message}, HTTP 409 表示状态过期，须刷新而不自动重试动作。

RoomView: {code,revision,hostId,status:'waiting'|'playing'|'finished'|'aborted',players:[{id,name,avatar,ready,online}],me,serverNow,game:null|GameView}。
GameView: {id,version,phase:'action'|'nope'|'favor'|'future'|'defuse'|'insert'|'finished',current,remaining,attacked,deadline,players:[{id,name,avatar,alive,count}],hand:[{id,type}],deckCount,discard:[{id,type}],pending:null|{actor,type,target,named,count,nopeCount},future?:[{id,type}],bomb?:{id,type},winner,logs:[{id,text}],privateLog:[{id,text}]}。
仅预知本人收到 future，只有本人的 hand。phase favor 的 pending.target 是交牌玩家。phase defuse/insert current 为处理者。pending 内无私人牌序。所有状态由服务器广播；客户端不可生成权威牌序。

共享牌种：bomb,defuse,attack,skip,favor,shuffle,future,nope,cat1,cat2,cat3,cat4,cat5。shared/cards.js 为 CommonJS 导出 {CARDS, TYPES}；CARDS[type]={name,short,description,color,symbol}。
