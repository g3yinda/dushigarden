# 微信云托管启动配置｜2026-10-04

2026-10-08昵称整改：新Dockerfile设置`WX_CONTENT_SECURITY_MODE=cloudrun`，须先在“云调用”添加`/wxa/msg_sec_check`权限并开启“开放接口服务”，再构建新版本。保持原有登录和CA变量；同时重新上传小游戏。详见[昵称审核部署步骤](../docs/implementation/nickname-content-security.md)。以下启动排障记录保留历史上下文。

2026-10-05最新：用户修正HOST后确认手机体验版正常建房；认证进行中。具体运行版本/存储未独立查询，工程收尾与下一阶段见[项目交接](../docs/11-第一阶段交接与项目记忆.md)。下文TLS/启动待验收属于排障历史。

最新2026-10-05：boomcat-005微信登录请求发生TLS_FAILED，当前Dockerfile已补CA安装及NODE_EXTRA_CA_CERTS；需重新构建并部署后验收，见[证书修复与部署步骤](../docs/implementation/wechat-login-unavailable.md)。

此前进展：用户已确认云托管环境prod-d2gqiy08z19bd1427的服务发布成功。本地小游戏已适配并切换到服务boomcat；真实云登录、授权和手机关闭调试验收待完成，操作见[连接切换说明](../docs/implementation/cloudrun-transport.md)。下面启动失败记录保留为故障历史。

## 本次失败原因

用户提供的boomcat-001构建日志显示镜像构建成功，但容器启动在server/index.js的生产凭据检查处退出。Back-off restarting failed container是重复启动失败的结果；直接原因是运行环境缺少WX_APP_ID或WX_APP_SECRET，单条异常不能区分具体缺少哪一项。

Dockerfile设置NODE_ENV=production，默认运行wechat模式，使用微信code换取身份。代码上传private.*.key不替代AppSecret；当前Dockerfile不会复制或加载项目根目录的.env文件。本机未找到已配置的正式AppSecret，也没有可用的云托管CLI/管理连接，无法代替用户直接写入云端密钥。

## 控制台配置

进入实际微信云托管环境，打开服务boomcat，在服务设置或新版本部署配置中找到运行环境变量。按控制台当前界面设置以下键值；环境变量绑定服务版本，保存后须重新部署包含这些变量的版本。仅修改本地文件或构建参数不能保证运行容器收到变量。[官方环境变量说明](https://docs.cloudbase.net/run/deploy/configuring/environment/envs)

| 名称 | 值 |
| --- | --- |
| NODE_ENV | production |
| BOOMCAT_MODE | wechat |
| HOST | 0.0.0.0 |
| PORT | 8787 |
| WX_APP_ID | wxf7af6d01a9bbfdbd |
| WX_APP_SECRET | 在控制台填入该AppID对应的真实AppSecret |

部署端口也设置8787，与当前Dockerfile和PORT一致。AppSecret由管理员在当前AppID的微信公众平台开发管理→开发设置→开发者ID中获取，在云托管控制台填写；不进入Dockerfile、仓库、前端配置、聊天或日志。

可参考[JSON配置模板](wechat-cloudrun.config.example.json)。其中WX_APP_SECRET故意留空，不能原样作为最终配置；必须在控制台私下补齐真实值。模板只包含公开参数。

## 验证顺序与范围

1. 新部署版本进入运行状态，启动日志显示wechat模式，原有缺少凭据异常消失。
2. 请求/api/health应返回ok:true、mode:wechat、phoneDebug:false。此结果仅证明服务启动，不证明AppSecret真实有效。
3. 当前小游戏客户端已适配云托管链路并配置实际环境ID、服务名，测试身份已关闭；须重新上传体验包。真实wx.login凭据调用/api/session成功后，才算生产登录验证通过。
4. 房间状态目前使用内存和本地文件，Dockerfile的/data卷声明不等于云托管已提供持久化。正式切流前需要处理容器重启/多实例状态一致性，再完成关闭调试的手机建房、加入和完整对局验证。

不能通过改成local/preview或去掉启动检查来替代生产登录配置。

## 本轮证据

本机使用现有源码验证：两个变量均缺少、仅有AppID、仅有AppSecret三种情况均重现启动拒绝；补齐公开AppID和无效测试密钥后，正式模式启动成功，健康接口HTTP 200，mode:wechat、phoneDebug:false。无效测试密钥只用于启动验证，没有请求微信身份接口，也未验证真实登录。

启动诊断阶段只新增配置模板与说明，没有更改后端鉴权逻辑、镜像或现有腾讯云测试服务。后续云托管发布成功由用户反馈；客户端已另行完成切换，云端健康和真实登录没有独立验证。
