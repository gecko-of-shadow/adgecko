await import("file://src/general/filter-options.js");
const F = globalThis.GeckoFilterOptions || globalThis.FilterOptions || Object.values(globalThis).find(v=>v&&v.convertLine);
console.log(Object.keys(globalThis).filter(k=>/ilter/i.test(k)));
for (const l of ["||evil.example^$all", "||evil.example^$document", "||evil.example^"]) {
  const r = F.convertLine(l); console.log(l, JSON.stringify(r), r && r[1] ? JSON.stringify(F.keyToCondition(r[1])) : "");
}
