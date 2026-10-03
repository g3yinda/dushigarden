"use strict";
const U = require('./controller');
// A real WeChat native authorization button overlays the Canvas placeholder.
// It is never created until the user opens the avatar picker.
function createWechatAvatarButton({wx, page}) {
  let button = null, geometry = '', generation = 0, destroyed = false;
  function hide() {
    generation++;
    button?.destroy();
    button = null; geometry = '';
  }
  function sync(rect) {
    if (destroyed || !rect || page.data.modal !== 'profile' || page.data.busy ||
        typeof wx.createUserInfoButton !== 'function') { hide(); return; }
    const label = page.data.avatarUrl ? '已使用微信头像 · 更换' : '使用微信头像';
    const key = [rect.x,rect.y,rect.w,rect.h,label].join(':');
    if (button && geometry === key) return;
    hide(); const ticket = generation;
    try {
      button = wx.createUserInfoButton({type:'text',text:label,withCredentials:false,lang:'zh_CN',
        style:{left:rect.x,top:rect.y,width:rect.w,height:rect.h,lineHeight:rect.h,
          backgroundColor:'#edf6ff',borderColor:'#0071e3',borderWidth:1,borderRadius:rect.h/2,
          color:'#0071e3',fontSize:16,textAlign:'center'}});
      geometry = key;
      button.onTap(res => {
        if (destroyed || ticket !== generation || page.data.modal !== 'profile' || page.data.busy) return;
        const url = U.normalizeWechatAvatar(res?.userInfo?.avatarUrl);
        if (!url) {
          page.notice(res?.errMsg?.includes('deny') || res?.errMsg?.includes('cancel')
            ? '未使用微信头像，可以继续选择猫狗头像' : '暂未获取到微信头像，请重试');
          return;
        }
        page.useWechatAvatar(url);
        hide();
      });
    } catch {
      hide();page.notice('微信头像授权暂时不可用，请重试或选择猫狗头像');
    }
  }
  return {sync,hide,destroy(){hide();destroyed=true;}};
}
module.exports = {createWechatAvatarButton};
