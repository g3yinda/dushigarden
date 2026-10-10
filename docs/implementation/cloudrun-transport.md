# 云托管连接切换｜2026-10-04

最新2026-10-05：用户新体验版已收到后端登录错误，云托管链路可达；用户提供TLS失败及HOST误填日志，修复后已确认手机体验版建房成功；多人完整局、云数据恢复及后台条件仍待验收。见[当前登录故障](wechat-login-unavailable.md)。

## 当前结果

用户已确认微信云托管发布成功。本地小游戏客户端已切换为wx.cloud.callContainer：初始化云开发环境cloudbase-d7gs58am20088d298，请求云托管环境prod-d2gqiy08z19bd1427，服务boomcat，AppID为wxf7af6d01a9bbfdbd。云托管后台运行状态来自用户反馈，尚未通过本机真实微信SDK验证。

当前私有miniprogram/config.js不再含临时域名、测试访问码或本地身份，project.config.json及开发工具私有覆盖配置的urlCheck=true。旧连接配置保存在Git忽略的.data目录，权限600；原腾讯云预览服务未改动。配置切换自动清除旧后端会话，保留昵称和头像。正式模式不开放验证Bot，联机验证须用两个以上真实账号。

请求保留/api路径、JSON数据、Bearer会话及25秒轮询超时；wx.cloud初始化只执行一次，能力/权限错误不会退回临时HTTP。云API不提供原wx.request的RequestTask，abort仅停止客户端等待并忽略迟到结果，不能取消已送到服务端的操作。

## 用户下一步

1. 云托管控制台核对运行版本服务名boomcat、端口8787、监听HOST=0.0.0.0；运行变量为NODE_ENV=production、BOOMCAT_MODE=wechat，WX_APP_ID对应当前AppID，WX_APP_SECRET正确。密钥仅在运行环境配置。
2. 核对云托管环境已关联当前AppID，调用权限允许该小游戏。callContainer不要求request合法域名；关联/授权和服务实际运行仍须成立。[官方接入说明](https://docs.cloudbase.net/run/develop/access/mini)
3. 微信开发者工具打开本项目，重新编译；不要运行npm start、dev:phone或configure-preview，因为这些会重新生成本地/预览配置。需要恢复云托管配置时执行npm run configure:cloudrun -- --apply，然后npm run check:release。
4. 上传新的开发版本并重新选为体验版。旧体验包不会随本地配置或后端部署自动更新。本次未代替用户上传、重新提审或发布。
5. 手机关闭开发调试，退出旧体验版后重新扫码；验证真实登录、建房、另一账号加入、2–5人基础局和6人扩展局、Wi-Fi/蜂窝网络、前后台恢复。失败时收集开发工具Console中的错误码，以及同一时刻云托管服务日志；不提供Token、AppSecret或原始私有登录数据。
6. 关闭调试体验版通过后，再提交新版本审核。

## 自动验证结果与边界

完整544项自动测试通过，语法/小游戏入口/资源和发布配置检查通过，源码包约1.88MiB。另发现开发工具project.private.config.json会覆盖域名检查，已扩展切换工具同步开启并保留其他私有选项；发布检查也读取最终有效设置。

云SDK调用和微信code换身份使用测试桩；2人与6人测试通过真实本地HTTP后端的wechat模式完成会话、建房、加入、准备、开局、抽牌和关房，同时检查生产Bot入口返回403。现有本地HTTP/Bot测试继续覆盖2–6人，不能将其写成云端真机完整对局通过。

源码配置与语法检查仅证明打包配置符合预期，不能查询微信后台关联权限或判断AppSecret有效。云托管尚需处理房间状态的容器重启持久化及多实例一致性：当前RoomService使用内存/本地JSON。单实例只避免同时多个实例分房，不保证重启数据保留；不要在未处理共享状态前增加实例数。
