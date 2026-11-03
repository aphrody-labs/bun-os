// Tauri's Resource class evaluates this symbol while its module is imported.
// Install it before module scripts run on older Android and iOS web views.
if (typeof Symbol["asyncDispose"] !== "symbol") {
  Object.defineProperty(Symbol, "asyncDispose", {
    value: Symbol.for("Symbol.asyncDispose"),
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
