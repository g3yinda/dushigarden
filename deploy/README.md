# 腾讯云公网调试与正式发布

2026-10-05最新：用户修正HOST后确认手机体验版正常建房；认证进行中。具体运行版本/存储未独立查询，工程收尾与下一阶段见[项目交接](../docs/11-第一阶段交接与项目记忆.md)。下文TLS/启动待验收属于排障历史。

2026-10-05云托管TLS修复：已更新Dockerfile的CA安装与Node额外CA配置；新包为output/deploy/boomcat-cloudrun-tls-fix-2026-10-05.zip。保持原boomcat服务、端口与登录变量，重新构建部署；真实证书挂载和手机建房仍待验证。见[定位与操作步骤](../docs/implementation/wechat-login-unavailable.md)。

2026-10-04最新：用户确认云托管发布成功，本地已切换callContainer连接prod-d2gqiy08z19bd1427/boomcat；重新上传及关闭调试手机验收待完成。见[云托管接入](../docs/implementation/cloudrun-transport.md)。

启动故障历史：2026-10-04用户正在部署微信云托管服务boomcat，boomcat-001镜像构建成功但缺少正式微信登录运行变量而重启失败。控制台配置、模板和本地复现证据见[微信云托管启动配置](wechat-cloudrun-startup.md)。下面的腾讯云临时服务记录继续保留，不能当作云托管已部署成功。

后端：单实例 Docker / Node.js 24，独立数据卷。公网调试使用 `BOOMCAT_MODE=preview`，每个 API 请求（公共健康/卡牌目录除外）都需要随机访问码；即使请求经回环代理转发也不放行无认证请求。此模式不承载真实微信账号登录，Bot 可用，网页入口不开放。不要上传调试包作为正式版本。

## 当前部署约定（v0.11.2）

- SSH 别名 `tencent-prod`，目标 43.142.80.120，ubuntu 账号；使用已有 SSH 配置，私钥不进入仓库。
- 目录 `/home/ubuntu/boomcat/`；镜像 `boomcat-preview:0.11.2`；容器 `boomcat-preview`。
- 端口仅绑定 `127.0.0.1:8790`；数据卷 `boomcat-preview-data`。不改动原有 Nginx、SSH 或防火墙规则。
- HTTPS 使用官方 `cloudflare/cloudflared` 临时 Tunnel，容器 `boomcat-preview-tunnel`。不要求购买新域名；随机地址可能随隧道重建改变，不能作为正式发布域名。
- 临时模式秘钥仅存放服务器 `preview.env`、本地忽略的 `.env.preview` 与旧客户端配置备份（当前 `miniprogram/config.js` 已切换云托管）；实际文件 600 权限。

只打包 Dockerfile、package.json、server、shared、web，不上传本地对局、个人配置、SSH 密钥、截图与聊天记录。构建完成后数据卷保留，容器以非 root 身份运行。

## 客户端配置

每次准备审核上传前，先执行`npm run check:release`。检查会一次列出阻塞项并以非零状态退出，不打印访问码。2026-10-04切换前配置曾有六项阻塞；当前云托管配置检查通过，后台授权和真机验收仍须完成；这条命令不自动配置微信后台白名单，也不能拦截开发工具直接上传。已出现用户1.0.0审核因手机建房网络失败被拒，见[审核故障记录](../docs/implementation/review-network-failure.md)。正式验收必须关闭手机调试模式。

在 `.env.preview` 中保存后端的访问码，在微信开发工具重新编译，扫码真机调试。正式发布检查必须拒绝 `publicPreview`、本地身份和调试访问码；正式环境应关闭 preview，启用 `NODE_ENV=production` 的微信 code 换身份流程，配置后端 AppSecret、已备案 HTTPS 域名与 request 白名单。

微信备案、类目和审核必须在真实管理后台完成；当前浏览器安全策略拦截微信公众平台，不能换 Safari 绕过。管理员在其浏览器核对后台信息与完成审核提交。上传成功仅代表开发版本，审核通过和实际发布要分别确认。

## 历史 v0.5.0 升级记录

完整扩展后端已部署，保留既有访问码、数据卷和运行中的隧道。升级前快照备份在数据卷 `/data/backup-before-v0.5.0-<timestamp>.json`（600权限），旧镜像及停止的 `boomcat-preview-before-v0.5.0` 容器保留用于回滚。新六人开局76张、28张起始牌堆已通过公网API验证；历史六人快照继续原规则。源码位于 `/home/ubuntu/boomcat/releases/v0.5.0/`。

## 升级与回退

当前源目录 `/home/ubuntu/boomcat/releases/v0.11.2/`；升级前在数据卷保存600权限快照，原容器停止并改名 `boomcat-preview-before-v0.11.2`，新镜像沿用原卷和600权限环境文件，仅绑定回环端口；健康失败恢复旧容器。当前发布证据见 [公网状态](../docs/10-公网测试与发布状态.md) 与 [验收记录](../docs/08-第一版验收记录.md#v0112-对局记录入口)。

部署前核查源码、未跟踪文件、Git历史、归档、容器构建输入和日志，拒绝私钥、Token、私人配置、快照与截图；源码归档同时带 `.dockerignore`，不包含miniprogram的实际密钥配置。新提交使用GitHub noreply作者地址。推送保护不能代替该检查。

服务器升级不等于微信正式发布。手机需要重新编译/扫码，真实设备表现与朋友多人试玩仍要记录。不可在已有游戏中注入测试牌或覆盖状态；独立验收房测试完关闭，不影响用户原房间。
