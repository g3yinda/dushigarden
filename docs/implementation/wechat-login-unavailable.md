# 云托管微信登录不可用｜2026-10-05

最新结果：2026-10-05用户修正HOST后反馈手机体验版已能正常创建房间。真实建房链路已由用户实测，具体健康云版本、设备/网络、证书挂载未独立查询；后续真人完整局与恢复验收见[阶段交接](../11-第一阶段交接与项目记忆.md)。下文保留排障经过。

## 最新部署阻塞：boomcat-007的HOST末尾多出反引号

用户提供boomcat-007启动日志：getaddrinfo EAI_AGAIN，hostname为0.0.0.0后面附带一个反引号字符。server/index.js将process.env.HOST直接传给server.listen；本地Dockerfile默认HOST正确。因此当前实际运行配置含多余字符，Node将其视为主机名并尝试DNS解析，服务尚未监听8787便退出；探针connection refused及Back-off均为后果。此日志不能用于判断此前TLS证书修复是否成功。

在原boomcat服务的新版本运行环境变量中，清空HOST的值后手动输入四段零组成的IPv4地址：

```text
0.0.0.0
```

值中不要包含反引号、引号、空格或HOST=。核对变量名为HOST、部署端口与PORT均为8787，其他正式登录变量及NODE_EXTRA_CA_CERTS保持此前配置。提交修正后的新版本并等待运行；如果自动继承旧变量，应在新版本表单再次确认。启动正常后再将新版本流量切为100%，然后手机关闭调试重新扫码建房。无需修改小游戏或重新制作源码包。

本地已核对Dockerfile及启动代码，用net.isIP确认0.0.0.0为合法IPv4、附带反引号后不再是IP；没有代用户修改云控制台或验证新版本运行状态。

## 最新证据：TLS_FAILED

用户提供boomcat-005实际运行日志：`phase=request, reason=TLS_FAILED, elapsedMs=50`。故障已定位到后端访问微信登录接口的TLS校验层，尚未收到微信身份交换结果。不能把此日志解释为AppSecret错误；原日志没有具体TLS错误码，仍不能排除证书过期、域名不匹配等分支。

当前Dockerfile原先未显式安装ca-certificates，也未让Node启动时加载云托管代理的额外CA。本次修复安装`apk add --no-cache ca-certificates`，并配置`NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt`；保留TLS验证和真实微信登录。平台证书是否在当前服务挂载、能否由node用户读取，仍需在实际运行容器确认，不能将本地测试当作已确认云端证书存在。[微信官方模板](https://github.com/WeixinCloud/wxcloudrun-express/blob/main/Dockerfile)包含CA证书安装步骤；[Node官方说明](https://nodejs.org/download/release/v24.15.0/docs/api/cli.html#node_extra_ca_certsfile)明确额外CA在启动时读取，缺失/格式无效会警告并忽略。

若仍TLS失败，新日志增加白名单tlsCode、platformCACertPresent布尔值、extraCACount数量，不记录证书内容、登录code、密钥或身份。platformCACertPresent=false说明预期证书未挂载；存在但extraCACount=0需检查读取权限、证书格式、运行版本是否实际带有上述ENV，以及控制台是否覆盖同名变量；有额外CA仍失败按具体tlsCode继续定位。不得设置NODE_TLS_REJECT_UNAUTHORIZED=0。

### 部署本次修复

1. 解压`output/deploy/boomcat-cloudrun-tls-fix-2026-10-05.zip`，在云托管环境prod-d2gqiy08z19bd1427的**原服务boomcat**部署新版本，上传解压后的完整目录，以根目录Dockerfile构建，勿另建test1。
2. 保持端口8787、HOST=0.0.0.0、NODE_ENV=production、BOOMCAT_MODE=wechat、WX_APP_ID及私下配置的WX_APP_SECRET。Dockerfile已设证书变量；如控制台另设同名NODE_EXTRA_CA_CERTS，应与`/app/cert/certificate.crt`一致。不要上传项目中的private.*.key或.env。
3. 待部署成功并确认流量切到新版本，用手机微信退出后重新扫码体验版，关闭开发调试并创建房间。此次仅后端改动，不需要重新上传已切为callContainer的客户端。浏览器云端调试没有wx.login code，不能用网页建房结果验收正式登录。
4. 成功进入房间后再邀请第二位体验者验证联机；若失败，只提供最新`[wechat-login]`日志。尚未代用户操作云端部署或手机验收。

### 本次测试边界

先用本地独立HTTPS服务复现未信任证书失败，再补配置后验证信任CA成功及其他自签名证书仍被拒绝。测试使用临时自签名证书、真实Node子进程HTTPS fetch，不发送任何微信密钥；它证明Node额外CA机制和预期配置有效，不证明当前平台证书挂载或真实微信登录成功。本机无Docker，未本地构建容器镜像。554项全量自动测试通过，发布配置与资源检查、git diff --check通过。新归档共22个文件，已校验ZIP完整性、修复Dockerfile/安全TLS日志包含和私密文件排除；SHA256：`6fd42284a03d51efa05d6493e93b720f8ceab5223d50ec626857d8416befdf29`。

## 实际故障与定位

用户重新部署并扫码体验版后，首页不再直接报告网络失败；点击创建好友房等待十几秒后显示“微信登录暂时不可用，请稍后再试”。此提示来自后端exchangeWechatCode的LOGIN_UNAVAILABLE（HTTP503），表示请求微信jscode2session时fetch失败、非2xx或JSON解析失败。等待时长与后端8秒超时相符，但不能据此直接确认DNS、证书或出网规则。

原代码在同一catch中吞掉所有上游异常；AppID/AppSecret无效如果已收到微信JSON通常会进入LOGIN_FAILED而不是该提示。诊断阶段不能将新问题直接归因密钥错误，也不能将先前模拟登录通过作为真实登录证据。当时尚未取得云日志；现在用户已提供上面的TLS日志。浏览器计算机操作因当前URL安全策略而停止；不尝试换浏览器绕过。

## 本地诊断修复

登录交换模块移到server/wechat-login.js。保留HTTPS、8秒超时与真实微信身份，不启用本地身份或信任客户端openid。禁止跟随接口重定向。失败时输出[wechat-login]和经过白名单分类的phase/reason/耗时、HTTP状态或微信数字错误码；不输出原始错误、URL、AppSecret、code、session_key和openid。40013/40125返回LOGIN_CONFIG，code错误继续LOGIN_FAILED，连接/响应问题继续LOGIN_UNAVAILABLE。

server/probe-wechat.js仅使用没有参数的固定HTTPS接口探测连通性，不读取或传输AppSecret及玩家身份。微信返回缺参数数字错误码是预期结果，代表HTTPS请求及JSON返回可用，不代表登录成功。

## 云端下一步

可先在当前运行容器的终端执行无密钥探测；不要在本机终端替代云容器的结果。若控制台没有终端入口，将新的后端诊断源码包部署为boomcat新版本，保持原端口/正式环境变量，再手机尝试建房，读取日志中的[wechat-login]一行。仅后端更新不需要重新上传当前体验包。

运行容器已有新源码时的命令：node server/probe-wechat.js。

| 结果 | 应调查的云端层 |
| --- | --- |
| CONNECT_TIMEOUT / CONNECTION_FAILED | 云容器出网、代理、上游连接；检查服务实际网络配置，不先延长超时 |
| DNS_FAILED | 运行环境DNS及api.weixin.qq.com解析 |
| TLS_FAILED | 证书链、云端接口代理证书与镜像CA；保留TLS验证，不设置NODE_TLS_REJECT_UNAUTHORIZED=0 |
| HTTP_ERROR / INVALID_JSON | 上游状态、代理响应；不要把完整正文贴进日志 |
| INVALID_CONFIG，40013/40125 | 当前运行版本的WX_APP_ID/WX_APP_SECRET；在控制台私下修正 |
| API_ERROR，40029 | 新鲜wx.login code、AppID对应关系；不自动重放同一个code |

以上为初始诊断流程；现在已按TLS证据准备修复包。仍不能宣称本地验证已经解决云端出网或真实手机登录问题。源码包不包括前端私有配置、密钥、对局、测试、文档、截图、Git历史或用户新增图片。

## 本轮验证

552项全量自动测试通过；语法、小游戏入口、资源及发布配置检查通过，git diff --check通过。首次全量检查发现启动测试只复制旧依赖清单，补齐新登录模块后重跑通过。真实云SDK、微信登录上游、手机建房仍未验证。源码诊断包保存于output/deploy/boomcat-cloudrun-login-diagnostics-2026-10-05.zip，清单限定Dockerfile、.dockerignore、package.json、server/shared/web；已检查私钥排除、归档完整性和新增登录模块包含。没有代替用户部署云托管、推送Git或修改现有预览服务。
