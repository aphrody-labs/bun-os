if ("__TAURI__" in window) {
  var __TAURI_PLUGIN_APHRODY__ = (function (c, e) {
    "use strict";
    return {
      bunInfo: function () {
        return c.invoke("plugin:aphrody|bun_info");
      },
      bunRestart: function () {
        return c.invoke("plugin:aphrody|bun_restart");
      },
      bunRequest: function (p, i) {
        i = i || {};
        var h = Array.isArray(i.headers) ? i.headers : Object.entries(i.headers || {});
        return c.invoke("plugin:aphrody|bun_request", {
          request: { method: i.method || "GET", path: p, headers: h, body: i.body == null ? null : i.body },
        });
      },
      onBunLog: function (f) {
        return e.listen("aphrody://bun-log", function (v) {
          f(v.payload);
        });
      },
    };
  })(window.__TAURI__.core, window.__TAURI__.event);
  Object.defineProperty(window.__TAURI__, "aphrody", { value: __TAURI_PLUGIN_APHRODY__ });
}
