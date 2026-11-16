import importlib.util, sys
spec = importlib.util.spec_from_file_location("pfl", "scripts/pack-filter-lists.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for body in ["", "<!DOCTYPE html><html><body>Sign in to Wi-Fi</body></html>", "[Adblock Plus 2.0]\n! Title: EasyList\n||ads.exa"]:
    e = m.extract_list(body)
    print(repr(body[:30]), "domains", len(e[0]), "scoped", len(e[1]))
