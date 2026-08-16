#!/usr/bin/env python3
"""Build the offline Cargo registry used to verify every Glenda course tag."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
from pathlib import Path, PurePosixPath


COURSE_REFS = tuple(
    [f"course/lab{number}-complete" for number in range(1, 9)]
    + ["course/lab9-candidate", "course/lab10-candidate"]
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent
        / "runner-cache"
        / "glenda-cargo-registry.tar.gz",
    )
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    checkout = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
    )
    if checkout.returncode != 0 or checkout.stdout.strip() != "true":
        raise SystemExit("--source must be a Git checkout of the Glenda course")
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo")).resolve(
        strict=True
    )
    packages = locked_registry_packages(source)
    with tempfile.TemporaryDirectory(prefix="glenda-runner-cache-") as temporary:
        base = Path(temporary) / "base"
        staging = Path(temporary) / "cargo"
        homes = [cargo_home]
        if args.output.is_file():
            with tarfile.open(args.output, "r:gz") as archive:
                archive.extractall(base, filter="data")
            homes.append(base)
        for name, version, checksum in sorted(packages):
            copy_package(homes, staging, name, version, checksum)
        write_archive(staging, args.output.resolve())
    print(f"wrote {args.output} with {len(packages)} locked registry packages")


def locked_registry_packages(source: Path) -> set[tuple[str, str, str]]:
    packages: dict[tuple[str, str], str] = {}
    lock_count = 0
    for reference in COURSE_REFS:
        present = subprocess.run(
            ["git", "-C", str(source), "cat-file", "-e", f"{reference}:Cargo.lock"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if present.returncode != 0:
            continue
        lock = subprocess.run(
            ["git", "-C", str(source), "show", f"{reference}:Cargo.lock"],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout
        lock_count += 1
        for package in tomllib.loads(lock)["package"]:
            if not str(package.get("source", "")).startswith("registry+"):
                continue
            key = (str(package["name"]), str(package["version"]))
            checksum = str(package.get("checksum", ""))
            if len(checksum) != 64:
                raise SystemExit(f"{reference} has no registry checksum for {key[0]} {key[1]}")
            previous = packages.setdefault(key, checksum)
            if previous != checksum:
                raise SystemExit(f"conflicting checksums for {key[0]} {key[1]}")
    if lock_count == 0:
        raise SystemExit("none of the Glenda course refs contains Cargo.lock")
    return {(name, version, checksum) for (name, version), checksum in packages.items()}


def copy_package(
    cargo_homes: list[Path],
    staging: Path,
    name: str,
    version: str,
    checksum: str,
) -> None:
    crate_name = f"{name}-{version}.crate"
    crates: list[Path] = []
    for cargo_home in cargo_homes:
        crates = sorted((cargo_home / "registry" / "cache").glob(f"*/{crate_name}"))
        if crates:
            break
    if len(crates) != 1:
        raise SystemExit(f"expected one cached {crate_name}, found {len(crates)}; run cargo fetch --locked")
    crate = crates[0]
    if hashlib.sha256(crate.read_bytes()).hexdigest() != checksum:
        raise SystemExit(f"Cargo checksum mismatch for {crate_name}")
    registry = crate.parent.name
    copy_file(crate, staging / "registry" / "cache" / registry / crate_name)
    cargo_home = crate.parents[3]
    source = cargo_home / "registry" / "src" / registry / f"{name}-{version}"
    if not source.is_dir():
        raise SystemExit(f"unpacked Cargo source is missing for {name} {version}")
    shutil.copytree(
        source,
        staging / "registry" / "src" / registry / source.name,
        dirs_exist_ok=True,
    )
    index = cargo_home / "registry" / "index" / registry / ".cache" / index_path(name)
    if not index.is_file():
        raise SystemExit(f"sparse registry index is missing for {name}")
    copy_file(index, staging / "registry" / "index" / registry / ".cache" / index_path(name))
    config = cargo_home / "registry" / "index" / registry / "config.json"
    if config.is_file():
        copy_file(config, staging / "registry" / "index" / registry / "config.json")


def index_path(name: str) -> Path:
    lowered = name.lower()
    if len(lowered) == 1:
        return Path("1") / lowered
    if len(lowered) == 2:
        return Path("2") / lowered
    if len(lowered) == 3:
        return Path("3") / lowered[0] / lowered
    return Path(lowered[:2]) / lowered[2:4] / lowered


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def write_archive(staging: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for source in sorted(staging.rglob("*"), key=lambda item: item.as_posix()):
                    relative = PurePosixPath(source.relative_to(staging).as_posix())
                    info = archive.gettarinfo(str(source), arcname=str(relative))
                    info.uid = info.gid = 0
                    info.uname = info.gname = "root"
                    info.mtime = 0
                    if info.isfile():
                        with source.open("rb") as handle:
                            archive.addfile(info, handle)
                    else:
                        archive.addfile(info)
    os.replace(temporary, output)


if __name__ == "__main__":
    main()
