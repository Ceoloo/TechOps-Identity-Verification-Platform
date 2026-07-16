#!/usr/bin/env python3
"""Lightweight secret-pattern scanner for CI.

Scans tracked files for high-signal secret patterns (hardcoded passwords,
cloud keys, provider tokens, private keys). It is intentionally dependency
-free and conservative: it looks for *assigned literal* secrets, not
environment-variable references.

Exit codes:
    0  no likely secrets found
    1  likely secret(s) found (CI should fail)

Usage:
    python scripts/secret_scan.py [root]
"""

from __future__ import annotations

import os
import re
import sys

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("AWS access key id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Private key block", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----")),
    ("OpenAI/Anthropic-style key", re.compile(r"\bsk-[A-Za-z0-9]{20,}")),
    ("NVIDIA api key", re.compile(r"\bnvapi-[A-Za-z0-9_\-]{20,}")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}")),
    (
        "Hardcoded password/secret literal",
        re.compile(
            r"(?i)(password|passwd|secret|api_key|apikey|client_secret|refresh_token)"
            r"\s*[:=]\s*['\"][^'\"$#{}<>\s]{8,}['\"]"
        ),
    ),
]

# Values that are obviously placeholders, not real secrets.
ALLOW = re.compile(
    r"(?i)(os\.environ|getenv|process\.env|example|placeholder|your[_-]|xxx+|"
    r"redact|masked:|changeme|dummy|<[^>]+>|\{\{)"
)

SKIP_DIRS = {".git", "node_modules", "__pycache__", ".terraform", "dist", "build",
             ".next", ".venv", "venv", "archives"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".lock", ".map",
            ".tfstate", ".pyc"}
# Files that legitimately document/scan for these patterns.
SKIP_FILES = {"secret_scan.py", ".env.example", "SECURITY.md", "SEAMS.md"}


def iter_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_FILES:
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in SKIP_EXT:
                continue
            yield os.path.join(dirpath, name)


def scan(root: str) -> int:
    findings: list[str] = []
    for path in iter_files(root):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for lineno, line in enumerate(fh, 1):
                    if ALLOW.search(line):
                        continue
                    for label, pat in PATTERNS:
                        if pat.search(line):
                            findings.append(f"{path}:{lineno}: possible {label}")
                            break
        except (OSError, UnicodeError):
            continue
    if findings:
        print("POTENTIAL SECRETS DETECTED (values not printed):", file=sys.stderr)
        for f in findings:
            print(f"  {f}", file=sys.stderr)
        print(f"\n{len(findings)} finding(s). Remove secrets and use env vars.", file=sys.stderr)
        return 1
    print("secret_scan: no likely secrets found.")
    return 0


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    raise SystemExit(scan(root))
