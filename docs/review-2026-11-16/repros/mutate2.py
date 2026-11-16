import json, subprocess, sys, pathlib, re
R = pathlib.Path("docs/review-2026-11-16/repros/repo")
OUT = pathlib.Path("docs/review-2026-11-16/repros/mutation-results.txt")
muts = json.load(open(sys.argv[1]))
only = sys.argv[2:]
for m in muts:
    if only and m["id"] not in only:
        continue
    p = R / m["file"]
    orig = p.read_text()
    if orig.count(m["old"]) != 1:
        with OUT.open("a") as f: f.write(f"{m['id']} BAD-PATTERN count={orig.count(m['old'])}\n")
        continue
    p.write_text(orig.replace(m["old"], m["new"]))
    ts = m.get("tests") or ["test/"]
    try:
        r = subprocess.run(["/opt/node22/bin/deno", "test", "--no-lock", "--allow-read", "--allow-run", "--allow-env", "--fail-fast", *ts],
                           cwd=R, capture_output=True, text=True, timeout=m.get("timeout", 900))
        out = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
        summ = [l for l in out.splitlines() if re.search(r"^(ok|FAILED) \|", l)]
        fails = re.findall(r"^(.+?) => (test/[^:]+):\d+", out, re.M)
        res = "SURVIVED" if r.returncode == 0 else "KILLED"
        line = f"{m['id']} {res} {summ[-1] if summ else ''} first-fail={fails[:3]}"
    except subprocess.TimeoutExpired:
        line = f"{m['id']} TIMEOUT(killed?)"
    finally:
        p.write_text(orig)
    with OUT.open("a") as f: f.write(line + "\n")
