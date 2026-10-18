"""Small, deterministic serialization utilities; no model physics."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def array_sha(array: np.ndarray) -> str:
    a = np.ascontiguousarray(array.astype(array.dtype.newbyteorder("<"), copy=False))
    h = hashlib.sha256(canonical({"dtype": a.dtype.str, "shape": list(a.shape)}))
    raw = memoryview(a).cast("B")
    for i in range(0, len(raw), 8 * 1024 * 1024):
        h.update(raw[i:i + 8 * 1024 * 1024])
    return h.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".earthforge-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(canonical(value) + b"\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def finite_number(value: Any, name: str, lower: float, upper: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not lower <= value <= upper:
        raise ValueError(f"{name} must be finite and in [{lower}, {upper}]")
    return float(value)


def integer(value: Any, name: str, lower: int, upper: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= upper:
        raise ValueError(f"{name} must be an integer in [{lower}, {upper}]")
    return value


@contextmanager
def job_lock(directory: Path):
    """OS-released exclusive lock; a crashed process does not strand a job."""
    with (directory / ".earthforge.lock").open("a+b") as f:
        if os.name == "nt":
            import msvcrt
            if f.tell() == 0:
                f.write(b"0"); f.flush()
            f.seek(0)
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as e:
                raise RuntimeError("Another process is writing this Earth Forge job") from e
            try:
                yield
            finally:
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as e:
                raise RuntimeError("Another process is writing this Earth Forge job") from e
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
