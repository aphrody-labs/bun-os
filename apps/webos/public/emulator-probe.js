// Records the Web Audio contexts the page creates so qualification can assert that audio was wired.
(() => {
  const created = [];
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Native = globalThis[name];
    if (!Native) continue;
    globalThis[name] = class extends Native {
      constructor(...args) {
        super(...args);
        created.push(this);
      }
    };
  }
  globalThis.__audioProbe = () => ({ contexts: created.length, running: created.filter((c) => c.state === "running").length });
})();
