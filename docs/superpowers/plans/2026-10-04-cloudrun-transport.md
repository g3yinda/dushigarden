# 微信小游戏云托管连接适配计划

> 执行方式：沿用用户已确认的云托管修复方案，在当前分支顺序执行。不给后台自动创建付费资源，不写入或输出AppSecret。

**目标：** 当前小游戏通过官方callContainer访问用户指定云托管环境，替代正式版临时域名请求；原有本地/公网测试链路继续可用。

**架构：** 增加独立api-transport模块，在HTTP配置时调用wx.request，在cloudrun配置时先初始化wx.cloud再调用wx.cloud.callContainer。云开发初始化环境为cloudbase-d7gs58am20088d298，云托管请求环境为prod-d2gqiy08z19bd1427，服务boomcat。复用Bearer会话和真实wx.login流程。云调用是Promise，取消只中止客户端等待并忽略迟到结果，不声称能取消服务端请求。

**技术栈：** 微信小游戏原生云API、Node.js CommonJS、node:test；无视觉变更，无新增客户端SDK。

## 1. 请求传输与业务接入

- [x] 在tests/cloudrun-transport.test.js先写失败用例：HTTP路径/headers不变；cloud.init完成后才调用，多个请求只初始化一次；callContainer的config.env、X-WX-SERVICE、/api路径、Bearer和25秒超时准确；不发送调试码；超时/取消后迟到结果不生效；云能力缺失不能静默退回临时HTTP。
- [x] 执行`node --test tests/cloudrun-transport.test.js`，确认模块未实现导致失败。
- [x] 新建miniprogram/lib/api-transport.js，导出createApiTransport(wx, config)，返回接受path/method/data/header/timeout/success/fail的请求函数及abort句柄。
- [x] 修改home.js的request方法调用缓存的传输函数；保留HTTP业务错误、长轮询引用和requestError分类，扩展云配置/权限错误分类。
- [x] 调整现有业务VM测试的require映射，让api-transport加载真实模块，而非错误地返回config桩。
- [x] 执行相关前端、运行桥和真实HTTP测试，确认原有2–6人链路不变。

## 2. 云托管配置与切换

- [x] 新建miniprogram/config.cloudrun.example.js，明确transport、cloudEnv、cloudRunEnv、cloudService、localMode=false和无测试访问码；无AppSecret。
- [x] 测试tools/release-config.js识别cloudrun配置，校验完整环境/服务名，继续拒绝所有测试标志和关闭urlCheck，不要求cloudrun填写apiBase域名。
- [x] 添加tools/configure-cloudrun.js及package.json的configure:cloudrun入口：按公开模板生成私有config.js并启用urlCheck；只在执行命令时切换，保留旧配置600权限备份，不打印内容。
- [x] 云托管切换时独立保存后端标识；若后端变化，清除旧Bearer令牌，避免把测试会话发到正式服务；保留头像和昵称。
- [x] 运行配置与业务回归测试，确认配置没有AppSecret或调试访问码。

## 3. 验收与文档

- [x] 执行`npm test`（真实HTTP测试需要回环监听权限）和`npm run check`，检查git diff。
- [x] 更新当前状态、云托管说明及验收记录，分别记录自动测试和云端/真机证据。
- [x] 获取用户服务运行状态；服务未启动时不自动切换当前测试配置。即使配置检查通过，也不能声称微信关联权限、云端状态持久化、真实登录和关闭调试对局通过。

**外部验收条件：** 云托管服务有实际运行版本和有效WX_APP_ID/WX_APP_SECRET；当前AppID具有目标服务调用权限；部署前处理本地文件状态的持久化/多实例问题；手机关闭调试后，真实账号完成建房、加入、2–5人和6人完整对局、后台恢复。

自动实现与配置切换已完成，用户确认服务发布成功；外部验收条件保持待验证。后台关联权限、状态持久化、真实登录和关闭调试的手机对局不能按清单勾选视为通过。
