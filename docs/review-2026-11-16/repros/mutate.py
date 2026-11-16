import json, subprocess, sys, shutil, pathlib, re
R = pathlib.Path("docs/review-2026-11-16/repros/repo")
muts = json.load(open(sys.argv[1]))
only = sys.argv[2:] 
def tests_for(f, extra):
    base = pathlib.Path(f).name
    out = set(extra)
    pats = [base]
    if f.endswith("general-background.js"): pats.append("fake-chrome-worker")
    for t in (R/"test").glob("*.test.js"):
        s = t.read_text()
        if any(p in s for p in pats): out.add(str(t.relative_to(R)))
    return sorted(out)
for m in muts:
    if only and m["id"] not in only: continue
    p = R/m["file"]; orig = p.read_text()
    assert orig.count(m["old"]) == 1, (m["id"], orig.count(m["old"]))
    p.write_text(orig.replace(m["old"], m["new"]))
    ts = m.get("tests") or tests_for(m["file"], m.get("extra", []))
    try:
        r = subprocess.run(["/opt/node22/bin/deno","test","--no-lock","--allow-read","--allow-run","--allow-env", *ts], cwd=R, capture_output=True, text=True, timeout=900)
        tail = [l for l in r.stdout.splitlines() if re.search(r"(passed|FAILED|failed)", l)][-1:]
        fails = re.findall(r"^(.*) => (test/[^:]+)", r.stdout, re.M)
        print(m["id"], "SURVIVED" if r.returncode==0 else "KILLED", tail, "files=%d"%len(ts), [f[1] for f in fails][:6], flush=True)
    finally:
        p.write_text(orig)
