#!/usr/bin/env python3
"""Fail-closed audit for the cumulative Glenda Lab 1-10 tag history."""

from __future__ import annotations

import argparse
import fnmatch
import json
import pathlib
import subprocess
import sys
from typing import Any


def git(repo: pathlib.Path, *arguments: str, binary: bool = False) -> bytes | str:
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments],
        capture_output=True,
        text=not binary,
    )
    if result.returncode != 0:
        error = result.stderr.decode(errors="replace") if binary else result.stderr
        raise RuntimeError(f"git {' '.join(arguments)} failed: {error.strip()}")
    return result.stdout


def resolve_ref(repo: pathlib.Path, stage: int, allow_candidate: bool) -> tuple[str, str]:
    complete = f"course/lab{stage}-complete"
    candidates = [complete]
    if allow_candidate and stage >= 9:
        candidates.append(f"course/lab{stage}-candidate")
    for reference in candidates:
        probe = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "--quiet", reference],
            capture_output=True,
            text=True,
        )
        if probe.returncode == 0:
            return reference, probe.stdout.strip()
    raise RuntimeError(f"missing course tag for Lab {stage}: expected {' or '.join(candidates)}")


def read_tree(repo: pathlib.Path, reference: str) -> dict[str, bytes]:
    listing = str(git(repo, "ls-tree", "-r", "--name-only", "-z", reference))
    paths = [value for value in listing.split("\0") if value]
    tree: dict[str, bytes] = {}
    for path in paths:
        tree[path] = git(repo, "show", f"{reference}:{path}", binary=True)  # type: ignore[assignment]
    return tree


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo", type=pathlib.Path)
    parser.add_argument("--through", type=int, choices=range(1, 11), default=10)
    parser.add_argument("--allow-candidate", action="store_true")
    parser.add_argument("--policy", type=pathlib.Path, default=pathlib.Path(__file__).parents[1] / "courses/glenda-spec/history-policy.json")
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()

    repo = args.repo.resolve()
    policy: dict[str, Any] = json.loads(args.policy.read_text(encoding="utf-8"))
    if policy.get("version") != "glenda-history-policy.v1":
        raise RuntimeError("unsupported Glenda history policy")
    introductions = policy.get("introductions")
    if not isinstance(introductions, list):
        raise RuntimeError("history policy introductions must be a list")

    roots = str(git(repo, "rev-list", "--max-parents=0", "HEAD")).splitlines()
    if len(roots) != 1:
        raise RuntimeError(f"Glenda history must have one orphan root, found {len(roots)}")

    records: list[dict[str, Any]] = []
    previous_commit: str | None = None
    violations: list[dict[str, Any]] = []
    for stage in range(1, args.through + 1):
        reference, tag_object = resolve_ref(repo, stage, args.allow_candidate)
        object_type = str(git(repo, "cat-file", "-t", reference)).strip()
        if object_type != "tag":
            violations.append({"stage": stage, "ref": reference, "kind": "lightweight-tag"})
        commit = str(git(repo, "rev-list", "-n", "1", reference)).strip()
        if previous_commit:
            ancestry = subprocess.run(
                ["git", "-C", str(repo), "merge-base", "--is-ancestor", previous_commit, commit],
                capture_output=True,
            )
            if ancestry.returncode != 0:
                violations.append({"stage": stage, "ref": reference, "kind": "non-cumulative-ancestry", "previous": previous_commit, "commit": commit})
        previous_commit = commit
        tree = read_tree(repo, reference)
        for introduction in introductions:
            introduced = int(introduction["stage"])
            if introduced <= stage:
                continue
            for pattern in introduction.get("paths", []):
                for path in tree:
                    if fnmatch.fnmatchcase(path, pattern):
                        violations.append({"stage": stage, "ref": reference, "kind": "future-path", "introduced": introduced, "path": path, "pattern": pattern})
            terms = [str(value).encode() for value in introduction.get("terms", [])]
            for path, content in tree.items():
                if b"\0" in content:
                    continue
                for term in terms:
                    if term in content:
                        violations.append({"stage": stage, "ref": reference, "kind": "future-term", "introduced": introduced, "path": path, "term": term.decode()})
        records.append({
            "stage": stage,
            "ref": reference,
            "tag_object": tag_object,
            "commit": commit,
            "tree": str(git(repo, "rev-parse", f"{reference}^{{tree}}")).strip(),
            "files": len(tree),
        })

    report = {
        "version": "glenda-history-audit.v1",
        "policy": policy["version"],
        "through": args.through,
        "allow_candidate": args.allow_candidate,
        "root_count": len(roots),
        "stages": records,
        "violations": violations,
        "status": "passed" if not violations else "failed",
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if not violations else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"glenda history audit failed: {error}", file=sys.stderr)
        raise SystemExit(2)
