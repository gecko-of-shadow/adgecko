#!/usr/bin/env python3
"""Scan a pull request or main push for forbidden strings.

Personal-string regexes come from the PRIVACY_PATTERNS environment variable,
one case-insensitive expression per line. Each line of text is tested as it
stands and again with camelCase, underscore and hyphen joins split into
separate words, so a \\bword\\b row also finds fooWord and foo_word.

If that variable is missing or empty, personal-string checks are skipped and
the job stays green with a warning annotation, except when REQUIRE_PATTERNS is
"true" (CI sets it on pushes to main): then a missing secret fails the job.

Always checked, without any secret (security review M-7):
  * obvious secrets: private-key blocks, GitHub/OpenAI/Anthropic/AWS/Google
    API/Slack token shapes, JSON web tokens;
  * IPv4 / IPv6 literals outside the documentation ranges (192.0.2.0/24,
    198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32), loopback, 0.0.0.0 and
    broadcast;
  * e-mail addresses, except noreply addresses and example/test/invalid
    domains;
  * home-directory paths (/home/<name>, /Users/<name>, C:/Users/<name> with
    either slash, /c/Users/<name>) with a real-looking name;
  * metadata in changed images (EXIF, XMP, comments, PNG text chunks other
    than "Software");
  * commit author/committer names and e-mails and commit messages in range.
Every changed file path is checked like a line of text, the whole tree's paths
too on pushes to main and with --all. A path that was deleted or renamed away
counts for personal strings and secrets only, as removed lines do. The allow
marker does not apply to paths.
Data files whose job is to list hosts (src/rules/*.json) skip the IP check, and
their quoted lower-case hostnames skip the personal-string check.
A line that must keep such a value for a good reason can carry the marker
"privacy-check: allow" (never honoured for secrets or personal strings).
--all scans every tracked file (maintainers; not used by CI).

Prints file paths and line numbers only, with any part of a path that matched
replaced by <redacted>. Does not print patterns, matches, or the environment
block. Each non-empty pattern line is registered with
::add-mask:: before any other output.
"""

import ipaddress
import os
import re
import subprocess
import sys

# Generic shapes that are safe to commit. They do not contain real secrets.
GENERIC_SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----"),
    re.compile(r"(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9])sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9]{20,}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])"),
    re.compile(r"(?<![A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}"),
    re.compile(r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
]

IP_KIND = "IP address"
EMAIL_KIND = "e-mail address"
HOME_KIND = "home-directory path"
IMAGE_KIND = "image metadata"
ALLOW_MARKER = "privacy-check: allow"
# Paths whose content is host data by design (blocklists): no IP check.
HOST_DATA_RE = re.compile(r"^src/rules/[^/]+\.json$")
# A whole quoted hostname. The last label starts with a letter, so an IP is not one.
QUOTED_HOST_RE = re.compile(r'"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+"')

DOC_NETS = [ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32")]
# Not after "Name/" (version tokens such as "Chrome/155.0.0.0").
# A full stop right after the value (end of a sentence) still counts.
IPV4_RE = re.compile(r"(?<![\w.])(?<![A-Za-z]/)(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\w)")
IPV6_CANDIDATE_RE = re.compile(r"(?<![\w:.])[0-9A-Fa-f:]*:[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*(?![\w:])")
EMAIL_RE = re.compile(r"(?<![\w.%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![\w-]|\.[\w-])")
# Any case (c:\users\...), Git Bash (/c/Users/...) and WSL (/mnt/c/Users/...).
HOME_RE = re.compile(r"(?:(?<![\w])/home/|(?<![\w])/Users/|(?<![\w])[A-Za-z]:[\\/]+Users[\\/]+|(?<![\w])(?:/mnt)?/[a-zA-Z]/Users/)([^\s/\\'\"`<>)\]|,;:]+)", re.I)
PLACEHOLDER_NAMES = {
    "user", "username", "name", "you", "me", "runner", "example", "public", "default", "shared", "all users",
    "someone", "your-name", "yourname", "your_name", "<user>", "<you>", "<name>", "%username%", "$user", "${user}", "*", "...",
}


def bad_ip(text):
    """True if text holds a literal public (globally routable) IP address.
    Documentation, loopback, private, link-local and other reserved ranges
    are not someone's address on the internet and are not reported."""
    for m in IPV4_RE.finditer(text):
        try:
            ip = ipaddress.ip_address(m.group(0))
        except ValueError:
            continue
        if ip.is_global and not any(ip in n for n in DOC_NETS):
            return True
    for m in IPV6_CANDIDATE_RE.finditer(text):
        cand = m.group(0).rstrip(".")
        # Real addresses have at least three groups; "::add-mask::" or "a::b"
        # in code would otherwise parse as addresses.
        if len([g for g in cand.split(":") if g]) < 3:
            continue
        try:
            ip = ipaddress.IPv6Address(cand)
        except ValueError:
            continue
        if ip.is_global and not any(ip in n for n in DOC_NETS):
            return True
    return False


def bad_email(text):
    for m in EMAIL_RE.finditer(text):
        address = m.group(0).lower()
        local, domain = address.rsplit("@", 1)
        if local in ("noreply", "no-reply", "git") or domain.endswith("users.noreply.github.com"):
            continue
        if domain in ("example.com", "example.org", "example.net") or domain.endswith((".example", ".test", ".invalid", ".localhost", ".local")):
            continue
        return True
    return False


def bad_home(text):
    for m in HOME_RE.finditer(text):
        name = m.group(1).strip().lower()
        if not name or set(name) <= {"."} or name in PLACEHOLDER_NAMES or name.startswith(("<", "$", "%", "{")):
            continue
        return True
    return False


def generic_kinds(line, path=None):
    """Checks that need no secret. path=None for commit metadata."""
    if ALLOW_MARKER in line:
        return []
    found = []
    if not (path and HOST_DATA_RE.match(path)) and bad_ip(line):
        found.append(IP_KIND)
    if bad_email(line):
        found.append(EMAIL_KIND)
    if bad_home(line):
        found.append(HOME_KIND)
    return found


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff")


def image_metadata(data, path):
    """True when an image carries metadata beyond a PNG "Software" note."""
    low = path.lower()
    if low.endswith(".png") and data.startswith(b"\x89PNG\r\n\x1a\n"):
        i = 8
        while i + 8 <= len(data):
            length = int.from_bytes(data[i:i + 4], "big")
            ctype = data[i + 4:i + 8]
            body = data[i + 8:i + 8 + length]
            if ctype == b"eXIf":
                return True
            if ctype in (b"tEXt", b"zTXt", b"iTXt"):
                key = body.split(b"\0", 1)[0]
                if key != b"Software":
                    return True
            if ctype == b"IEND":
                break
            i += 12 + length
        return False
    if low.endswith((".jpg", ".jpeg")) and data.startswith(b"\xff\xd8"):
        i = 2
        while i + 4 <= len(data) and data[i] == 0xFF:
            marker = data[i + 1]
            if marker in (0xD9, 0xDA):
                break
            length = int.from_bytes(data[i + 2:i + 4], "big")
            body = data[i + 4:i + 2 + length]
            if marker == 0xFE:
                return True
            if marker == 0xE1 and (body.startswith(b"Exif\0") or body.startswith(b"http://ns.adobe.com/xap/")):
                return True
            if marker == 0xED and body.startswith(b"Photoshop 3.0"):  # IPTC
                return True
            i += 2 + length
        return False
    if low.endswith(".webp") and data[:4] == b"RIFF":
        return b"EXIF" in data[12:] or b"XMP " in data[12:]
    if low.endswith(".gif") and data[:4] == b"GIF8":
        # Comment extension (0x21 0xFE) or an XMP application extension.
        return b"\x21\xfe" in data or b"XMP DataXMP" in data
    if low.endswith((".tif", ".tiff")):
        return True
    return False

PERSONAL_KIND = "forbidden personal string"
SECRET_KIND = "obvious secret"
PATH_SUFFIX = " in a file path"
REDACTED = "<redacted>"
CASE_CHANGE_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
JOIN_CHARS_RE = re.compile(r"[_-]+")
FILE_EXT_RE = re.compile(r"\.[A-Za-z][A-Za-z0-9]*(?=/|$)")


def emit(command, message, path=None, line=None):
    """Workflow command. message is a fixed phrase, never file contents."""
    if path is None:
        print(f"::{command}::{message}", flush=True)
        return
    safe = (
        path.replace("%", "%25")
        .replace("\r", "%0D")
        .replace("\n", "%0A")
        .replace(":", "%3A")
        .replace(",", "%2C")
    )
    print(f"::{command} file={safe},line={line}::{message}", flush=True)


def git_text(args):
    proc = subprocess.run(["git", "-c", "core.quotepath=false", *args], capture_output=True)
    if proc.returncode != 0:
        return None
    # Bytes, not text=True: that mode turns a bare CR into a line break.
    return proc.stdout.decode("utf-8", errors="replace")


def zero_sha(value):
    text = (value or "").strip()
    return text == "" or set(text) <= {"0"}


def resolve_range():
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    head = os.environ.get("HEAD_SHA") or os.environ.get("GITHUB_SHA") or "HEAD"
    base = os.environ.get("BASE_SHA", "")
    if event == "push" and zero_sha(base):
        return None, head
    if event == "pull_request" and zero_sha(base):
        emit("error", "Pull request base commit is missing")
        return "ERROR", head
    if not event and zero_sha(base):
        base = "origin/main"
    if zero_sha(base):
        return None, head
    if git_text(["rev-parse", "--verify", "--quiet", base + "^{commit}"]) is None:
        emit("error", "Base commit is not available")
        return "ERROR", head
    if git_text(["rev-parse", "--verify", "--quiet", head + "^{commit}"]) is None:
        emit("error", "Head commit is not available")
        return "ERROR", head
    return base, head


def changed_files(base, head):
    if base is None:
        out = git_text(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-z", head])
    else:
        out = git_text(["diff", "--name-status", "--find-renames", "-z", base, head])
    if out is None:
        return None
    # -z: NUL-separated and unquoted, so an odd path cannot split a record.
    tokens = out.split("\0")
    files = []
    index = 0
    while index < len(tokens):
        status = tokens[index][:1]
        if not status:
            index += 1
        elif status in ("R", "C"):
            # Status, old path, new path. A renamed-away path is a removed path.
            if status == "R":
                files.append(("D", tokens[index + 1]))
            files.append((status, tokens[index + 2]))
            index += 3
        else:
            files.append((status, tokens[index + 1]))
            index += 2
    return files


def tree_paths(head):
    out = git_text(["ls-tree", "-r", "-z", "--name-only", "--full-tree", head])
    if out is None:
        return None
    return [path for path in out.split("\0") if path]


def escape_command_data(value):
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def lines_of(text):
    """Split on newline only. str.splitlines() also splits on CR, U+2028, U+2029
    and other separators, so a forged line after one could change how a diff
    is read and hide what follows it."""
    return text.split("\n")


def secret_rows(raw):
    return [line.rstrip("\r") for line in lines_of(raw)]


def publish_masks(raw):
    """Register pattern lines with the log masker. This must be the first output."""
    for line in secret_rows(raw):
        if line.startswith("\ufeff"):
            line = line.lstrip("\ufeff")
        cleaned = line.strip()
        if cleaned == "":
            continue
        print(f"::add-mask::{escape_command_data(cleaned)}", flush=True)
        if cleaned != line:
            print(f"::add-mask::{escape_command_data(line)}", flush=True)


def load_personal_patterns(raw):
    if raw.strip() == "":
        if os.environ.get("REQUIRE_PATTERNS", "").lower() == "true":
            emit("error", "PRIVACY_PATTERNS secret is not set (required on pushes to main)")
            write_summary("PRIVACY_PATTERNS secret is not set. It is required on pushes to main.\n")
            return None
        emit("warning", "PRIVACY_PATTERNS secret is not set")
        write_summary("PRIVACY_PATTERNS secret is not set. Personal-string checks were skipped.\n")
        return []
    patterns = []
    for index, line in enumerate(secret_rows(raw), start=1):
        if line.startswith("\ufeff"):
            line = line.lstrip("\ufeff")
        line = line.strip()
        if line == "":
            continue
        try:
            compiled = re.compile(line, re.IGNORECASE)
        except re.error:
            emit("error", f"PRIVACY_PATTERNS line {index} is not a valid regular expression")
            return None
        if compiled.search("") is not None:
            emit("error", f"PRIVACY_PATTERNS line {index} matches empty text")
            return None
        patterns.append(compiled)
    if not patterns:
        emit("warning", "PRIVACY_PATTERNS secret is not set")
        write_summary("PRIVACY_PATTERNS secret is not set. Personal-string checks were skipped.\n")
    return patterns


def write_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(text)


def split_joins(text):
    """Word boundaries do not fall inside fooWord or foo_word. Here they do."""
    return JOIN_CHARS_RE.sub(" ", CASE_CHANGE_RE.sub(" ", text))


def kinds_for(line, personal, path=None, generic=True):
    found = []
    # Third-party hostnames in host data may hold these words, and only those.
    text = QUOTED_HOST_RE.sub('""', line) if path and HOST_DATA_RE.match(path) else line
    if personal:
        views = (text, split_joins(text))
        if any(pattern.search(view) for pattern in personal for view in views):
            found.append(PERSONAL_KIND)
    if any(pattern.search(line) for pattern in GENERIC_SECRET_PATTERNS):
        found.append(SECRET_KIND)
    if generic:
        found.extend(generic_kinds(line, path))
    return found


def path_kinds(path, personal, removed=False):
    """A path is text like any line, but no marker can excuse it."""
    text = path.replace(ALLOW_MARKER, "")
    # The IP check refuses a value after "name/" or before ".word", so each
    # segment is also checked alone, without its extension.
    found = []
    for piece in [text] + FILE_EXT_RE.sub("", text).split("/"):
        found += [kind for kind in kinds_for(piece, personal, generic=not removed) if kind not in found]
    return found


def redact_path(path, personal):
    """The path to print: printing a matched path would print the match."""
    parts = [REDACTED if path_kinds(part, personal) else part for part in path.split("/")]
    safe = "/".join(parts)
    return safe if safe != path else REDACTED


def scan_paths(entries, personal, findings, shown):
    for status, path in entries:
        kinds = path_kinds(path, personal, removed=status == "D")
        if not kinds:
            continue
        shown[path] = redact_path(path, personal)
        remember(findings, shown[path], 1, [kind + PATH_SUFFIX for kind in kinds])


def remember(findings, path, line, kinds):
    if not path or line < 1:
        return False
    for kind in kinds:
        findings.add((path, line, kind))
    return True


def in_repo(path):
    if path.startswith("/") or path.startswith("\\"):
        return False
    return ".." not in path.split("/")


def scan_file(path, personal, findings):
    if not in_repo(path) or os.path.islink(path):
        return True
    try:
        data = open(path, "rb").read()
    except OSError:
        emit("error", "Could not read a changed file")
        return False
    if path.lower().endswith(IMAGE_EXT):
        if image_metadata(data, path) and not remember(findings, path, 1, [IMAGE_KIND]):
            return False
        return True
    if b"\0" in data:
        return True
    text = data.decode("utf-8", errors="replace")
    for lineno, line in enumerate(lines_of(text), start=1):
        kinds = kinds_for(line, personal, path)
        if kinds and not remember(findings, path, lineno, kinds):
            emit("error", "A changed file matched but its path could not be reported")
            return False
    return True


def parse_hunk(header):
    match = re.match(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", header)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def diff_path(header, prefix):
    if header == "/dev/null":
        return None
    if header.startswith(prefix):
        return header[len(prefix):]
    return header


def scan_diff(diff, personal, findings):
    old_path = None
    new_path = None
    old_line = 0
    new_line = 0
    in_hunk = False
    for raw in lines_of(diff):
        if raw.startswith("diff --git "):
            in_hunk = False
            old_path = None
            new_path = None
            continue
        if raw.startswith("@@"):
            parsed = parse_hunk(raw)
            in_hunk = parsed is not None
            if parsed:
                old_line, new_line = parsed
            continue
        if not in_hunk:
            if raw.startswith("--- "):
                old_path = diff_path(raw[4:], "a/")
            elif raw.startswith("+++ "):
                new_path = diff_path(raw[4:], "b/")
            continue
        if raw.startswith("\\"):
            continue
        if raw.startswith("+"):
            text = raw[1:]
            path = new_path or old_path
            line = new_line
            new_line += 1
        elif raw.startswith("-"):
            text = raw[1:]
            path = old_path or new_path
            line = old_line
            old_line += 1
        elif raw.startswith(" "):
            text = raw[1:]
            path = new_path or old_path
            line = new_line
            old_line += 1
            new_line += 1
        else:
            continue
        # The generic checks (IPs, e-mails, paths) look only at added lines:
        # a change that removes such a value must not fail for it.
        kinds = kinds_for(text, personal, path, generic=raw.startswith("+"))
        if not kinds:
            continue
        if not remember(findings, path, max(line, 1), kinds):
            emit("error", "A diff line matched but its file path could not be determined")
            return False
    return True


def scan_commits(base, head, personal, findings):
    """Author/committer names and e-mails and the messages of commits in range."""
    spec = head if base is None else base + ".." + head
    # Every field follows a NUL, which no field can hold, so a message cannot
    # forge a record.
    args = ["log", "--format=%x00%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B", spec]
    if base is None:
        args.insert(1, "-1")
    out = git_text(args)
    if out is None:
        emit("error", "Could not read commit metadata")
        return False
    fields = out.split("\0")[1:]
    for start in range(0, len(fields), 6):
        parts = fields[start:start + 6]
        sha = parts[0]
        lines = parts[1:5] + lines_of("".join(parts[5:]))
        for index, text in enumerate(lines, start=1):
            kinds = kinds_for(text, personal)
            if kinds and not remember(findings, "commit " + sha, index, kinds):
                return False
    return True


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, OSError, ValueError):
        pass
    # Drop the secret from the environment before any other work so later
    # output, tracebacks, and child processes cannot dump it.
    raw = os.environ.pop("PRIVACY_PATTERNS", "")
    publish_masks(raw)
    personal = load_personal_patterns(raw)
    if personal is None:
        return 1
    base, head = resolve_range()
    if base == "ERROR":
        return 1
    files = changed_files(base, head)
    if files is None:
        emit("error", "Could not list changed files")
        return 1
    if base is None:
        diff = git_text(["diff-tree", "-p", "--root", "-U3", "--find-renames", head])
    else:
        diff = git_text(["diff", "-U3", "--find-renames", "--no-ext-diff", base, head])
    if diff is None:
        emit("error", "Could not read the diff")
        return 1

    findings = set()
    shown = {}
    if "--all" in sys.argv[1:]:
        tracked = git_text(["ls-files", "-z"])
        if tracked is None:
            emit("error", "Could not list tracked files")
            return 1
        files = [("M", f) for f in tracked.split("\0") if f]
        diff = ""
    entries = files
    if os.environ.get("REQUIRE_PATTERNS", "").lower() == "true":
        # A push to main: every path in the tree, not only the changed ones.
        tree = tree_paths(head)
        if tree is None:
            emit("error", "Could not list the tree")
            return 1
        entries = files + [("M", path) for path in tree]
    scan_paths(entries, personal, findings, shown)
    for status, path in files:
        if status == "D" or not in_repo(path) or os.path.islink(path) or not os.path.isfile(path):
            continue
        if not scan_file(path, personal, findings):
            return 1
    if not scan_diff(diff, personal, findings):
        return 1
    if "--all" not in sys.argv[1:] and not scan_commits(base, head, personal, findings):
        return 1

    if findings:
        for path, line, kind in sorted(findings):
            emit("error", kind, shown.get(path, path), line)
        write_summary(f"Privacy check failed on {len(findings)} finding(s).\n")
        print(f"Privacy check failed on {len(findings)} finding(s).", flush=True)
        return 1
    print("Privacy check passed.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
