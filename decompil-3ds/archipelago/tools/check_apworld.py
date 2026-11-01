"""Static checks that an apworld follows the project rules. Standard library only, runs without Archipelago.

Usage: python check_apworld.py <world folder>

Generation must be self-contained: no network, no process, no file read outside the apworld, no dependency beyond
the Python standard library and Archipelago (its core modules and the packages Archipelago itself requires).
Client modules (client.py, *_client.py, client/, components.py) may use the network, but are imported at generation
too, so their top level may only define things. The runtime counterpart is test_generation_is_self_contained.py.

A finding that is a deliberate, reviewed exception is silenced by a comment on its line:
    # check_apworld: allow <reason>
"""

from __future__ import annotations

import ast
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ARCHIPELAGO_CORE = {
    "BaseClasses", "CommonClient", "entrance_rando", "Fill", "kvui", "NetUtils", "Options", "Patch",
    "rule_builder", "settings", "test", "Utils", "worlds",
}
# Third-party packages Archipelago itself pins in its requirements.txt; nothing else may be imported.
ARCHIPELAGO_REQUIREMENTS_GENERATION = {"schema", "typing_extensions"}
ARCHIPELAGO_REQUIREMENTS_CLIENT = ARCHIPELAGO_REQUIREMENTS_GENERATION | {
    "bsdiff4", "certifi", "colorama", "orjson", "platformdirs", "pymem", "websockets", "yaml",
}
GENERATION_FORBIDDEN_IMPORTS = {
    "asyncio": "network and event loop belong to the client",
    "ftplib": "network access",
    "http": "network access",
    "random": "use self.random (seeded per world), never the global random module",
    "socket": "network access",
    "ssl": "network access",
    "subprocess": "running external programs",
    "urllib": "network access",
    "webbrowser": "opening external programs",
}
GENERATION_FORBIDDEN_CALLS = {
    "open": "file access: ship data in the apworld and read it with pkgutil.get_data(__name__, ...)",
    "read_text": "file access: use pkgutil.get_data(__name__, ...)",
    "read_bytes": "file access: use pkgutil.get_data(__name__, ...)",
    "listdir": "file system access",
    "scandir": "file system access",
    "iterdir": "file system access",
    "glob": "file system access",
    "user_path": "user files are outside the apworld",
    "local_path": "Archipelago install files are outside the apworld",
    "get_settings": "host.yaml is a user file",
    "system": "running external programs",
    "popen": "running external programs",
    "startfile": "running external programs",
    "import_module": "dynamic imports hide dependencies",
    "__import__": "dynamic imports hide dependencies",
}
# Writing the world's own output is legitimate there; the runtime test checks it stays in the output directory.
OUTPUT_METHODS = {"generate_output"}
OUTPUT_ALLOWED_CALLS = {"open"}
ALWAYS_FORBIDDEN_CALLS = {"eval": "arbitrary code execution", "exec": "arbitrary code execution"}
PACKAGE_DATA_CALLS = {"get_data"}
OWN_PACKAGE_NAMES = {"__name__", "__package__"}
MANIFEST_FORBIDDEN_KEYS = {"version", "compatible_version"}
DEFINITION_STATEMENTS = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Assign,
                         ast.AnnAssign, ast.If, ast.Try, ast.Pass)
VERSION = re.compile(r"\d+\.\d+\.\d+")
TEMPLATE_TOKEN = re.compile(r"__[A-Z][A-Z0-9_]*__")
ALLOW_MARKER = re.compile(r"#\s*check_apworld:\s*allow\s+\S")


@dataclass(frozen=True)
class Problem:
    path: Path
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.message}"


def is_client_module(path: Path, world: Path) -> bool:
    relative = path.relative_to(world)
    return (
        relative.parts[0] == "client"
        or path.name in {"client.py", "components.py"}
        or path.name.endswith("_client.py")
    )


def imported_modules(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Import):
        return [alias.name.split(".")[0] for alias in node.names]
    if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
        return [node.module.split(".")[0]]
    return []


def called_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def reads_own_package(node: ast.Call) -> bool:
    """pkgutil.get_data(__name__, "data/x.json"): the world's own package, never a path escaping it."""
    if not node.args or not (isinstance(node.args[0], ast.Name) and node.args[0].id in OWN_PACKAGE_NAMES):
        return False
    resource = node.args[1] if len(node.args) > 1 else None
    return resource is None or (isinstance(resource, ast.Constant) and ".." not in str(resource.value))


class ModuleChecker(ast.NodeVisitor):
    def __init__(self, path: Path, generation: bool) -> None:
        self.path = path
        self.generation = generation
        self.allowed_imports = ARCHIPELAGO_REQUIREMENTS_GENERATION if generation else ARCHIPELAGO_REQUIREMENTS_CLIENT
        self.functions: list[str] = []
        self.problems: list[Problem] = []

    def report(self, node: ast.AST, message: str) -> None:
        self.problems.append(Problem(self.path, getattr(node, "lineno", 0), message))

    def visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.functions.append(node.name)
        self.generic_visit(node)
        self.functions.pop()

    visit_AsyncFunctionDef = visit_FunctionDef  # noqa: N815 - ast API

    def visit_Import(self, node: ast.Import | ast.ImportFrom) -> None:
        for module in imported_modules(node):
            if module not in sys.stdlib_module_names and module not in ARCHIPELAGO_CORE | self.allowed_imports:
                self.report(node, f"imports '{module}': only stdlib, Archipelago and its own requirements")
            elif self.generation and module in GENERATION_FORBIDDEN_IMPORTS:
                self.report(node, f"imports '{module}' in generation code: {GENERATION_FORBIDDEN_IMPORTS[module]}")

    visit_ImportFrom = visit_Import  # noqa: N815 - ast API

    def visit_Call(self, node: ast.Call) -> None:
        name = called_name(node)
        in_output = bool(set(self.functions) & OUTPUT_METHODS)
        if name in ALWAYS_FORBIDDEN_CALLS:
            self.report(node, f"calls {name}(): {ALWAYS_FORBIDDEN_CALLS[name]}")
        elif name == "load" and getattr(getattr(node.func, "value", None), "id", None) == "yaml":
            self.report(node, "yaml.load: use Utils.parse_yaml")
        elif self.generation and name in PACKAGE_DATA_CALLS and not reads_own_package(node):
            self.report(node, f"calls {name}() on another package: only pkgutil.get_data(__name__, 'relative/path')")
        elif self.generation and name in GENERATION_FORBIDDEN_CALLS:
            if not (in_output and name in OUTPUT_ALLOWED_CALLS):
                self.report(node, f"calls {name}() in generation code: {GENERATION_FORBIDDEN_CALLS[name]}")
        self.generic_visit(node)


def check_python(path: Path, world: Path) -> list[Problem]:
    source = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as error:
        return [Problem(path, error.lineno or 0, f"syntax error: {error.msg}")]
    generation = not is_client_module(path, world)
    checker = ModuleChecker(path, generation)
    checker.visit(tree)
    problems = checker.problems
    if not generation:
        # Client modules are imported when the world loads, i.e. at generation: their top level must only define.
        problems += [Problem(path, statement.lineno, "client module runs code at import time")
                     for statement in tree.body
                     if not isinstance(statement, DEFINITION_STATEMENTS) and not is_docstring(statement)]
    lines = source.splitlines()
    return [problem for problem in problems if not ALLOW_MARKER.search(lines[problem.line - 1])]


def is_docstring(statement: ast.stmt) -> bool:
    return isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant)


def check_manifest(world: Path) -> list[Problem]:
    path = world / "archipelago.json"
    if not path.is_file():
        return [Problem(path, 0, "missing manifest (mandatory from Archipelago 0.7.0)")]
    manifest = json.loads(path.read_text(encoding="utf-8"))
    problems = [Problem(path, 0, f"must not define '{key}' (added by the build)") for key in MANIFEST_FORBIDDEN_KEYS
                if key in manifest]
    if not isinstance(manifest.get("game"), str) or not manifest["game"]:
        problems.append(Problem(path, 0, "missing 'game'"))
    problems.extend(Problem(path, 0, f"'{key}' must be set as major.minor.build")
                    for key in ("world_version", "minimum_ap_version")
                    if not VERSION.fullmatch(str(manifest.get(key, ""))))
    return problems


def check_layout(world: Path) -> list[Problem]:
    problems = []
    if (world / "requirements.txt").exists():
        problems.append(Problem(world / "requirements.txt", 0, "third-party dependencies are not allowed"))
    package_dirs = {path.parent for path in world.rglob("*.py")}
    problems += [Problem(directory, 0, "contains Python files but no __init__.py")
                 for directory in sorted(package_dirs) if not (directory / "__init__.py").is_file()]
    if not (world / "docs" / "setup_en.md").is_file():
        problems.append(Problem(world / "docs", 0, "missing setup_en.md"))
    if not list((world / "docs").glob("en_*.md")):
        problems.append(Problem(world / "docs", 0, "missing en_<game>.md game page"))
    for path in sorted(world.rglob("*")):
        if path.is_file() and path.suffix in {".py", ".json", ".md"}:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                token = TEMPLATE_TOKEN.search(line)
                if token:
                    problems.append(Problem(path, number, f"unreplaced template token {token.group()}"))
    return problems


def check_world(world: Path) -> list[Problem]:
    problems = check_manifest(world) + check_layout(world)
    for path in sorted(world.rglob("*.py")):
        if path.relative_to(world).parts[0] != "test":
            problems += check_python(path, world)
    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not Path(argv[1]).is_dir():
        print(__doc__.strip(), file=sys.stderr)
        return 2
    problems = check_world(Path(argv[1]))
    for problem in problems:
        print(problem)
    print(f"{len(problems)} problem(s)" if problems else "OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
