// Apply the nested path syntax that real wx.setData supports.
function applyData(data, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = value;
  }
}
module.exports = { applyData };
