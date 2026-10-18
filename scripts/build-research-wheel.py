"""Build a local platform wheel containing the native CLI and third-party notices.

Run with a Python that has setuptools/wheel. Does not compile or publish anything.
"""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--engine")
    parser.add_argument("--release", action="store_true", help="Build a public alpha artifact from a clean Git checkout")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True)
    source_commit = commit.stdout.strip() if commit.returncode == 0 else None
    clean = not status.stdout.strip() if status.returncode == 0 else None
    if args.release and (not source_commit or not clean):
        raise SystemExit("Public release wheels require a clean, committed source checkout")
    project_license = (root / "LICENSE").read_bytes()
    if (root / "python/LICENSE").read_bytes() != project_license:
        raise SystemExit("The Python license must match the root project license")
    binary = Path(args.engine) if args.engine else root / "target/release" / ("earthforge.exe" if sys.platform == "win32" else "earthforge")
    if not binary.is_file():
        raise SystemExit("Build the native engine first with cargo build --locked --release")
    output = Path(args.out).resolve(); output.mkdir(parents=True, exist_ok=True)
    cargo = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--offline", "--format-version", "1"], cwd=root))
    plat = sysconfig.get_platform().replace("-", "_").replace(".", "_")
    if sys.platform == "darwin":
        major, minor, *_ = map(int, platform.mac_ver()[0].split("."))
        # macOS 11+ wheel tags use major_0, including on later minor releases.
        if major >= 11:
            minor = 0
        plat = f"macosx_{major}_{minor}_{platform.machine()}"  # Conservative host platform, no older-OS claim.
    with tempfile.TemporaryDirectory(prefix="earthforge-wheel-") as tmp:
        stage = Path(tmp)
        shutil.copytree(root / "python/src", stage / "src", ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "_bin", "notices"))
        shutil.copy2(root / "python/pyproject.toml", stage / "pyproject.toml")
        shutil.copy2(root / "python/README.md", stage / "README.md")
        shutil.copy2(root / "LICENSE", stage / "LICENSE")
        package = stage / "src/earthforge"
        (package / "_bin").mkdir(); shutil.copy2(binary, package / "_bin" / binary.name)
        notices = package / "notices"; notices.mkdir()
        shutil.copy2(root / "LICENSE", notices / "PROJECT-LICENSE.txt")
        shutil.copy2(root / "crates/earthforge-core/licenses/V8.txt", notices / "V8.txt")
        dependencies = []
        for dep in cargo["packages"]:
            if dep["name"] == "earthforge-core":
                continue
            folder = Path(dep["manifest_path"]).parent
            license_files = [p for p in folder.iterdir() if p.is_file() and p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE", "COPYRIGHT"))]
            destination = notices / f"{dep['name']}-{dep['version']}"
            destination.mkdir()
            for path in license_files:
                shutil.copy2(path, destination / path.name)
            dependencies.append({"name": dep["name"], "version": dep["version"], "license": dep["license"], "noticeFiles": [p.name for p in license_files]})
        (notices / "dependencies.json").write_text(json.dumps(dependencies, indent=2)+"\n")
        (notices / "PROJECT-STATUS.txt").write_text("Earth Forge research alpha, licensed under MIT; see PROJECT-LICENSE.txt. Dependencies retain their respective licenses and notices. Research citation authorship remains to be finalized.\n")
        source_files = [p for directory in (root/"crates", root/"python/src") for p in directory.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix in (".rs", ".toml", ".py", ".json", ".txt")]
        hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files}
        for name in ["Cargo.lock", "Cargo.toml", "python/pyproject.toml", "LICENSE", "python/LICENSE"]:
            hashes[name] = hashlib.sha256((root/name).read_bytes()).hexdigest()
        info = {"schema": "earthforge-wheel-build-v1", "engineSha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "sourceFiles": hashes, "sourceCommit": source_commit, "sourceTreeClean": clean, "platformTag": plat, "buildSystem": {"system": platform.system(), "release": platform.release(), "architecture": platform.machine(), "libc": platform.libc_ver()}, "rustCompiler": subprocess.check_output(["rustc", "--version"], text=True).strip(), "projectLicense": "MIT", "publicRelease": args.release}
        (package / "build-info.json").write_text(json.dumps(info, indent=2)+"\n")
        # The CLI is Python-ABI independent, but the bundled executable is not platform independent.
        (stage / "setup.py").write_text('from setuptools import setup\nfrom wheel.bdist_wheel import bdist_wheel\nclass NativeWheel(bdist_wheel):\n    def finalize_options(self):\n        super().finalize_options()\n        self.root_is_pure=False\n    def get_tag(self):\n        return ("py3", "none", '+repr(plat)+')\nsetup(cmdclass={"bdist_wheel":NativeWheel})\n')
        subprocess.run([sys.executable, "-m", "pip", "wheel", "--disable-pip-version-check", "--no-cache-dir", "--no-deps", "--no-build-isolation", str(stage), "--wheel-dir", str(output)], check=True)


if __name__ == "__main__":
    main()
