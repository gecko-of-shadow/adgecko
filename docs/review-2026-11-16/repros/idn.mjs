import "src/threat/psl.js";
import "src/threat/compile.js";
console.log(globalThis.GeckoThreatCompile.userDomainReason("bücher.de"));
console.log(new URL("https://bücher.de/").origin, new URL("https://bücher.de/").hostname);
