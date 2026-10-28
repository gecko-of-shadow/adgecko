#!/usr/bin/env python3
"""Scan a pull request or main push for forbidden strings.

Personal-string regexes come from the PRIVACY_PATTERNS environment variable,
one case-insensitive expression per line. If that variable is missing or
empty, personal-string checks are skipped and the job stays green with a
warning annotation. Obvious secrets are always checked.

Prints file paths and line numbers only. Does not print patterns, matches,
or the environment block. Each non-empty pattern line is registered with
::add-mask:: before any other output.
"""

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
]

PERSONAL_KIND = "forbidden personal string"
SECRET_KIND = "obvious secret"


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
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", *args],
        capture_output=True,
        text=True,
        errors="replace",
    )
    if proc.returncode != 0:
        return None
    return proc.stdout


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
        out = git_text(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", head])
    else:
        out = git_text(["diff", "--name-status", "--find-renames", base, head])
    if out is None:
        return None
    files = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        path = parts[-1]
        files.append((status[0], path))
    return files


def escape_command_data(value):
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def publish_masks(raw):
    """Register pattern lines with the log masker. This must be the first output."""
    for line in raw.splitlines():
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
        emit("warning", "PRIVACY_PATTERNS secret is not set")
        write_summary("PRIVACY_PATTERNS secret is not set. Personal-string checks were skipped.\n")
        return []
    patterns = []
    for index, line in enumerate(raw.splitlines(), start=1):
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


def kinds_for(line, personal):
    found = []
    if any(pattern.search(line) for pattern in personal):
        found.append(PERSONAL_KIND)
    if any(pattern.search(line) for pattern in GENERIC_SECRET_PATTERNS):
        found.append(SECRET_KIND)
    return found


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
    if b"\0" in data:
        return True
    text = data.decode("utf-8", errors="replace")
    for lineno, line in enumerate(text.splitlines(), start=1):
        kinds = kinds_for(line, personal)
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
    for raw in diff.splitlines():
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
        kinds = kinds_for(text, personal)
        if not kinds:
            continue
        if not remember(findings, path, max(line, 1), kinds):
            emit("error", "A diff line matched but its file path could not be determined")
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
    for status, path in files:
        if status == "D" or not in_repo(path) or os.path.islink(path) or not os.path.isfile(path):
            continue
        if not scan_file(path, personal, findings):
            return 1
    if not scan_diff(diff, personal, findings):
        return 1

    if findings:
        for path, line, kind in sorted(findings):
            emit("error", kind, path, line)
        write_summary(f"Privacy check failed on {len(findings)} finding(s).\n")
        print(f"Privacy check failed on {len(findings)} finding(s).", flush=True)
        return 1
    print("Privacy check passed.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
