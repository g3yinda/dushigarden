# 玩家头像扩展设计

用户直接授权：进入游戏时可选择微信头像；内置头像共六只猫、四只狗。沿用现有 Apple 浅色、圆角和可爱原创插画，原四猫的编号与形象保持。

首页昵称左侧头像打开独立居中窗口。动物头像排列五列两行，前六项为猫、后四项为狗；每项有名字、44px以上触控区域、选中蓝圈；下方为“使用微信头像”按钮。窗口适配320px起手机和短屏，一屏完成，拒绝授权不影响游戏。

当前AppID属于小游戏，使用官方wx.createUserInfoButton原生按钮，由用户点击授权，withCredentials:false，不读取openid、性别、地区等无关字段。仅使用回调userInfo.avatarUrl，保留游戏昵称。无接口的浏览器提供全部动物选项并说明微信头像需在微信中选择。禁止自动弹出授权或用小程序chooseAvatar组件假装小游戏支持。

头像编号0–9；微信头像单独avatarUrl，内置选择清空该字段。仅接受HTTPS的wx.qlogo.cn、thirdwx.qlogo.cn头像路径；微信返回HTTP时客户端升级HTTPS。后端不代抓图片，不接受任意远程或本地文件地址。资料保存、座位、开局投影、选人和行动展示均传递头像；缓存按地址复用，失败回退内置头像。旧本地缓存和旧对局兼容。

官方依据（2026-10-03实际读取）：
- https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.createUserInfoButton.html
- https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.getUserInfo.html

原生授权真实结果仍须手机验证；发布前后台隐私保护指引需声明用户头像和房间内展示用途，图片域名配置需按正式平台要求核对。
