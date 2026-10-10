"use strict";

function cloudFailure(error) {
  const detail = String(error?.errMsg || error?.message || "").toLowerCase();
  if (/timeout|timed out/.test(detail)) return { code: "TIMEOUT", errMsg: "request:fail timeout" };
  if (/forbidden|permission|not authorized|无权限|未授权/.test(detail))
    return { code: "CLOUD_FORBIDDEN", errMsg: "cloud:fail forbidden" };
  if (/ssl|tls|cert|hand\s*shake/.test(detail)) return { code: "TLS_FAILED", errMsg: "request:fail ssl" };
  return { code: "CLOUD_SERVICE_UNAVAILABLE", errMsg: "cloud:fail service unavailable" };
}

function createApiTransport(wx, config) {
  let initialization;
  function initialize() {
    if (!initialization) {
      initialization = Promise.resolve().then(() => wx.cloud.init({ env: config.cloudEnv }))
        .catch(() => { initialization = null; throw { code: "CLOUD_INIT_FAILED", errMsg: "cloud:fail init" }; });
    }
    return initialization;
  }
  return function request(options) {
    const { path, ...httpOptions } = options;
    if (!config.transport || config.transport === "http")
      return wx.request({ ...httpOptions, url: config.apiBase + path });

    let finished = false, timer;
    function finish(callback, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options[callback]?.(result);
    }
    const task = { abort() { finish("fail", { code: "ABORTED", errMsg: "request:fail abort" }); } };
    const envPattern = /^[a-z0-9][a-z0-9-]{4,63}$/;
    const servicePattern = /^[a-z][a-z0-9-]{0,62}$/;
    if (config.transport !== "cloudrun" || config.localMode !== false || config.debugToken ||
        config.publicPreview === true || config.phoneDebug === true ||
        !envPattern.test(config.cloudEnv || "") || !envPattern.test(config.cloudRunEnv || "") ||
        !servicePattern.test(config.cloudService || "")) {
      finish("fail", { code: "CLOUD_CONFIG", errMsg: "cloud:fail configuration" });
      return task;
    }
    if (!wx.cloud || typeof wx.cloud.init !== "function" || typeof wx.cloud.callContainer !== "function") {
      finish("fail", { code: "CLOUD_UNAVAILABLE", errMsg: "cloud:fail unsupported" });
      return task;
    }
    timer = setTimeout(() => finish("fail", { code: "TIMEOUT", errMsg: "request:fail timeout" }), options.timeout || 12000);
    initialize().then(() => {
      if (finished) return;
      const header = {};
      for (const [key, value] of Object.entries(options.header || {})) {
        if (!["x-boomcat-debug", "x-wx-service"].includes(key.toLowerCase())) header[key] = value;
      }
      header["X-WX-SERVICE"] = config.cloudService;
      return wx.cloud.callContainer({ config: { env: config.cloudRunEnv }, path,
        method: options.method || "GET", data: options.data, header,
        timeout: options.timeout || 12000, dataType: "json" });
    }).then(result => { if (!finished) finish("success", result); })
      .catch(error => finish("fail", error?.code === "CLOUD_INIT_FAILED" ? error : cloudFailure(error)));
    return task;
  };
}

module.exports = { createApiTransport };
