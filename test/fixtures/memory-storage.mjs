// Import first in every fixture that runs with --location. Deno keeps localStorage on
// disk per origin and shares it between processes, so two fixture runs at once (parallel
// test files, two terminals, CI jobs) overwrote each other's twitch-adblock-*-opts keys.
// Each fixture process gets its own in-memory store instead.
const store = new Map();
const memoryStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true, writable: true });
