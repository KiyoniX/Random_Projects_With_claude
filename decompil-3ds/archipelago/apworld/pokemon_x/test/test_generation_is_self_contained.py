"""Generation must be self-contained: no network, no process, no file read outside this apworld, and no file written
outside the output directory.

A Python audit hook (PEP 578) sees these operations whatever API triggers them (open, os.open, io.FileIO, pkgutil,
pathlib, sockets, subprocess...). An operation counts against the world when one of the world's non-test modules is
on the call stack. Python importing code (.py and .pyc files opened by the import system) is not reading data and
is ignored; pkgutil.get_data on another package is a read like any other.
Code that runs when the world is first imported, and use of the global random module, cannot be seen from here:
tools/check_apworld.py covers them statically.
"""

import os
import socket
import sys
import tempfile
import threading
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from types import FrameType
from typing import Any

from Fill import distribute_items_restrictive
from test.general import gen_steps, setup_solo_multiworld
from worlds.AutoWorld import call_all

from ..world import PokemonXWorld

WORLD_DIR = Path(__file__).resolve().parent.parent
TEST_DIR = WORLD_DIR / "test"
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
FORBIDDEN_EVENTS = {
    "socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg", "socket.bind",
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.startfile", "ctypes.dlopen",
}
LISTING_EVENTS = {"os.listdir", "os.scandir", "glob.glob"}
CODE_SUFFIXES = {".py", ".pyc"}
IMPORT_SYSTEM = "<frozen importlib._bootstrap>"


def is_inside(path: Path, directory: Path | None) -> bool:
    return directory is not None and path.is_relative_to(directory)


class Sandbox:
    def __init__(self) -> None:
        self.armed = False
        self.output_dir: Path | None = None
        self.violations: list[str] = []
        # The checks below trigger audited events themselves (resolving paths); they must not be re-checked.
        self.inside_hook = threading.local()

    @contextmanager
    def arm(self, output_dir: Path | None) -> Iterator[None]:
        self.armed, self.output_dir, self.violations = True, output_dir, []
        try:
            yield
        finally:
            self.armed, self.output_dir = False, None

    def hook(self, event: str, args: tuple[Any, ...]) -> None:
        if not self.armed or getattr(self.inside_hook, "active", False):
            return
        self.inside_hook.active = True
        try:
            if self.world_code_on_stack():
                self.check_event(event, args)
        finally:
            self.inside_hook.active = False

    def check_event(self, event: str, args: tuple[Any, ...]) -> None:
        if event == "open":
            self.check_open(*args[:3])
        elif event in LISTING_EVENTS:
            self.check_read(args[0])
        elif event in FORBIDDEN_EVENTS:
            self.fail(f"{event} {args!r}")

    def check_open(self, path: Any, mode: str | None, flags: int) -> None:
        if isinstance(path, int):
            return  # Reopening a descriptor that was already checked when it was opened.
        writing = any(char in mode for char in "wax+") if mode else bool(flags & WRITE_FLAGS)
        target = Path(os.fsdecode(path)).resolve()
        if not writing and target.suffix in CODE_SUFFIXES and self.importing():
            return
        if writing and not is_inside(target, self.output_dir):
            self.fail(f"wrote outside the output directory: {target}")
        elif not writing:
            self.check_read(path)

    def check_read(self, path: Any) -> None:
        target = Path(os.fsdecode(path if path is not None else ".")).resolve()
        if not is_inside(target, WORLD_DIR) and not is_inside(target, self.output_dir):
            self.fail(f"read outside the apworld: {target}")

    def fail(self, message: str) -> None:
        self.violations.append(message)
        raise AssertionError(f"Generation is not self-contained: {message}")

    @staticmethod
    def importing() -> bool:
        frame: FrameType | None = sys._getframe(1)
        while frame is not None:
            if frame.f_code.co_filename == IMPORT_SYSTEM:
                return True
            frame = frame.f_back
        return False

    @staticmethod
    def world_code_on_stack() -> bool:
        frame: FrameType | None = sys._getframe(1)
        while frame is not None:
            path = Path(frame.f_code.co_filename)
            if path.is_absolute() and is_inside(path.resolve(), WORLD_DIR) and not is_inside(path.resolve(), TEST_DIR):
                return True
            frame = frame.f_back
        return False


# Audit hooks cannot be removed: one hook for the whole test session, active only while armed.
SANDBOX = Sandbox()
sys.addaudithook(SANDBOX.hook)


class TestGenerationIsSelfContained(unittest.TestCase):
    def test_full_generation(self) -> None:
        with tempfile.TemporaryDirectory() as output_directory, SANDBOX.arm(Path(output_directory).resolve()):
            multiworld = setup_solo_multiworld(PokemonXWorld, gen_steps)
            distribute_items_restrictive(multiworld)
            call_all(multiworld, "post_fill")
            call_all(multiworld, "generate_output", output_directory)
            multiworld.worlds[1].fill_slot_data()
        # Also catches violations the world swallowed with a broad except.
        self.assertEqual([], SANDBOX.violations)

    def test_sandbox_is_armed(self) -> None:
        # Code compiled under a world file name is world code for the sandbox, exactly like a real violation.
        def run_as_world_code(source: str) -> None:
            code = compile(source, str(WORLD_DIR / "world.py"), "exec")
            exec(code, {"os": os, "socket": socket, "target": sys.executable})  # Test probe: never exec in world code.

        probes = (
            "open(target, 'rb').close()",
            "os.close(os.open(target, os.O_RDONLY))",
            "os.listdir(os.path.dirname(target))",
            "socket.getaddrinfo('archipelago.gg', 38281)",
        )
        for probe in probes:
            with self.subTest(probe=probe), SANDBOX.arm(None), self.assertRaises(AssertionError):
                run_as_world_code(probe)
