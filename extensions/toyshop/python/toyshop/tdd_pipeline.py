"""TDD Pipeline - Test-Driven Development with permission-isolated agents.

Pipeline flow:
  Phase 1: Signature Extraction (pure Python, no agent)
  Phase 2: Test Generation (Test Agent - write mode, restricted to tests/)
  Phase 3: Code Implementation (Code Agent - blocked from tests/)
  Phase 4: White-box Verification (Test Agent - verify mode, read-only)
  Phase 5: Black-box Verification (auto-generated from spec.md scenarios)

Key design: agents have different tool permissions enforced at the executor level,
not just via prompt instructions.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING

from openhands.sdk import LLM, Agent
from openhands.sdk.conversation import Conversation
from openhands.sdk.tool import (
    ToolAnnotations,
    ToolDefinition,
    ToolExecutor,
    register_tool,
)

# Import tools to trigger registration
import openhands.tools.terminal  # noqa: F401
import openhands.tools.glob  # noqa: F401
import openhands.tools.grep  # noqa: F401

from openhands.tools.file_editor.definition import (
    TOOL_DESCRIPTION,
    FileEditorAction,
    FileEditorObservation,
    FileEditorTool,
)
from openhands.tools.file_editor.impl import FileEditorExecutor

# Reuse FileReadTool from ux_agent
from toyshop.ux_agent import FileReadTool

if TYPE_CHECKING:
    from openhands.sdk.conversation import LocalConversation
    from openhands.sdk.conversation.state import ConversationState


# =============================================================================
# Constants
# =============================================================================

MAX_WHITEBOX_RETRIES = 3
MAX_BLACKBOX_RETRIES = 2
MAX_TOTAL_RETRIES = 5


# =============================================================================
# Result types
# =============================================================================

@dataclass
class TestRunResult:
    """Parsed pytest output."""
    all_passed: bool
    total: int
    passed: int
    failed: int
    errors: int
    output: str


@dataclass
class SignatureManifest:
    """Output of signature extraction phase."""
    stub_files: list[str]
    test_dir: str
    modules: list[dict[str, Any]]
    interfaces: list[dict[str, Any]]


@dataclass
class TDDResult:
    """Result of the full TDD pipeline."""
    success: bool
    files_created: list[str] = field(default_factory=list)
    files_modified: list[str] = field(default_factory=list)
    test_files: list[str] = field(default_factory=list)
    stub_files: list[str] = field(default_factory=list)
    whitebox_passed: bool = False
    blackbox_passed: bool = False
    whitebox_output: str = ""
    blackbox_output: str = ""
    summary: str = ""
    retry_count: int = 0


# =============================================================================
# Directory-restricted file editor executor
# =============================================================================

class DirectoryRestrictedFileEditorExecutor(ToolExecutor):
    """FileEditorExecutor that restricts write operations by directory.

    Supports two modes:
    - allowed_write_dirs: whitelist — only allow writes under these dirs
    - blocked_write_dirs: blacklist — block writes under these dirs

    The `view` command is always allowed regardless of restrictions.
    """

    def __init__(
        self,
        workspace_root: str | None = None,
        allowed_write_dirs: list[Path] | None = None,
        blocked_write_dirs: list[Path] | None = None,
    ):
        self.inner = FileEditorExecutor(workspace_root=workspace_root)
        self.allowed_write_dirs = (
            [Path(d).resolve() for d in allowed_write_dirs]
            if allowed_write_dirs else None
        )
        self.blocked_write_dirs = (
            [Path(d).resolve() for d in blocked_write_dirs]
            if blocked_write_dirs else None
        )

    @staticmethod
    def _is_under(path: Path, directory: Path) -> bool:
        try:
            path.relative_to(directory)
            return True
        except ValueError:
            return False

    def __call__(
        self,
        action: FileEditorAction,
        conversation: "LocalConversation | None" = None,
    ) -> FileEditorObservation:
        # view is always allowed
        if action.command != "view":
            action_path = Path(action.path).resolve()

            # Whitelist check
            if self.allowed_write_dirs is not None:
                if not any(self._is_under(action_path, d) for d in self.allowed_write_dirs):
                    dirs_str = ", ".join(str(d) for d in self.allowed_write_dirs)
                    return FileEditorObservation.from_text(
                        text=(
                            f"Write operation '{action.command}' blocked on '{action_path}'. "
                            f"Only allowed under: [{dirs_str}]"
                        ),
                        command=action.command,
                        is_error=True,
                    )

            # Blacklist check
            if self.blocked_write_dirs is not None:
                if any(self._is_under(action_path, d) for d in self.blocked_write_dirs):
                    dirs_str = ", ".join(str(d) for d in self.blocked_write_dirs)
                    return FileEditorObservation.from_text(
                        text=(
                            f"Write operation '{action.command}' blocked on '{action_path}'. "
                            f"Writes forbidden under: [{dirs_str}]"
                        ),
                        command=action.command,
                        is_error=True,
                    )

        return self.inner(action, conversation)


# =============================================================================
# Restricted tool factories
# =============================================================================

def _make_test_file_editor(
    conv_state: "ConversationState", **params: Any
) -> Sequence[ToolDefinition]:
    """Factory: file_editor that can only write under tests/."""
    workspace = conv_state.workspace.working_dir
    executor = DirectoryRestrictedFileEditorExecutor(
        workspace_root=workspace,
        allowed_write_dirs=[Path(workspace) / "tests"],
    )
    return [
        FileEditorTool(
            action_type=FileEditorAction,
            observation_type=FileEditorObservation,
            description=(
                TOOL_DESCRIPTION
                + f"\n\nYour working directory is: {workspace}\n"
                + "RESTRICTION: You can only create/edit files under the tests/ directory."
            ),
            executor=executor,
            annotations=ToolAnnotations(
                title="test_file_editor",
                readOnlyHint=False,
                destructiveHint=True,
                idempotentHint=False,
                openWorldHint=False,
            ),
        )
    ]


def _make_code_file_editor(
    conv_state: "ConversationState", **params: Any
) -> Sequence[ToolDefinition]:
    """Factory: file_editor that cannot write under tests/."""
    workspace = conv_state.workspace.working_dir
    executor = DirectoryRestrictedFileEditorExecutor(
        workspace_root=workspace,
        blocked_write_dirs=[Path(workspace) / "tests"],
    )
    return [
        FileEditorTool(
            action_type=FileEditorAction,
            observation_type=FileEditorObservation,
            description=(
                TOOL_DESCRIPTION
                + f"\n\nYour working directory is: {workspace}\n"
                + "RESTRICTION: You CANNOT create/edit files under the tests/ directory."
            ),
            executor=executor,
            annotations=ToolAnnotations(
                title="code_file_editor",
                readOnlyHint=False,
                destructiveHint=True,
                idempotentHint=False,
                openWorldHint=False,
            ),
        )
    ]


# Register restricted tool variants
register_tool("test_file_editor", _make_test_file_editor)
register_tool("code_file_editor", _make_code_file_editor)


# =============================================================================
# Phase 1: Signature extraction (pure Python, no agent)
# =============================================================================

def _parse_design_interfaces(design_md: str) -> list[dict[str, str]]:
    """Parse interface signatures from design.md markdown."""
    interfaces: list[dict[str, str]] = []
    lines = design_md.split("\n")
    i = 0
    current_name = ""
    while i < len(lines):
        line = lines[i].strip()
        # Match "#### InterfaceName"
        if line.startswith("#### ") and not line.startswith("#### ADR-"):
            current_name = line[5:].strip()
        # Match signature line like "`def foo(...)` or `class Foo`"
        elif line.startswith("`") and line.endswith("`") and current_name:
            sig = line.strip("`").strip()
            interfaces.append({"name": current_name, "signature": sig})
            current_name = ""
        i += 1
    return interfaces


def _parse_design_modules(design_md: str) -> list[dict[str, str]]:
    """Parse module info from design.md markdown."""
    modules: list[dict[str, str]] = []
    lines = design_md.split("\n")
    in_modules = False
    current: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if stripped == "### Modules":
            in_modules = True
            continue
        if in_modules and stripped.startswith("### ") and stripped != "### Modules":
            # End of modules section
            if current:
                modules.append(current)
            break
        if in_modules and stripped.startswith("#### "):
            if current:
                modules.append(current)
            current = {"name": stripped[5:].strip(), "filePath": ""}
        if in_modules and stripped.startswith("- **Path:**"):
            path = stripped.replace("- **Path:**", "").strip().strip("`").strip()
            if current:
                current["filePath"] = path
    if current and current not in modules:
        modules.append(current)
    return modules


def _normalize_signature(name: str, sig: str) -> str:
    """Ensure signature is valid Python: prepend 'def name' if missing."""
    sig = sig.strip()
    if sig.startswith("def ") or sig.startswith("class "):
        return sig
    # Bare signature like "(a: float, b: float) -> float"
    if sig.startswith("("):
        return f"def {name}{sig}"
    # Just a type or name without parens
    return f"def {name}({sig})"


def _generate_stub_code(interfaces: list[dict[str, str]]) -> str:
    """Generate Python stub code from parsed interfaces."""
    lines: list[str] = [
        '"""Auto-generated stubs from design.md signatures."""',
        "",
        "from __future__ import annotations",
        "from typing import Any, List, Union",
        "from dataclasses import dataclass",
        "",
    ]

    # Group: separate classes from standalone functions
    classes: dict[str, list[dict[str, str]]] = {}
    functions: list[dict[str, str]] = []

    for iface in interfaces:
        sig = _normalize_signature(iface["name"], iface["signature"])
        iface = {**iface, "signature": sig}
        if sig.startswith("class "):
            class_name = sig.replace("class ", "").strip()
            classes[class_name] = []
        elif "self" in sig:
            # Method — find which class it belongs to
            # Heuristic: assign to the most recently defined class
            if classes:
                last_class = list(classes.keys())[-1]
                classes[last_class].append(iface)
            else:
                functions.append(iface)
        else:
            functions.append(iface)

    # Generate class stubs
    for class_name, methods in classes.items():
        lines.append(f"class {class_name}:")
        if not methods:
            lines.append("    pass")
        else:
            for method in methods:
                sig = method["signature"]
                lines.append(f"    {sig}:")
                lines.append(f'        raise NotImplementedError("TODO: implement {method["name"]}")')
                lines.append("")
        lines.append("")

    # Generate standalone function stubs
    for func in functions:
        sig = func["signature"]
        lines.append(f"{sig}:")
        lines.append(f'    raise NotImplementedError("TODO: implement {func["name"]}")')
        lines.append("")

    return "\n".join(lines)


def extract_signatures(workspace: Path) -> SignatureManifest:
    """Parse openspec/design.md and generate stub files.

    Returns a SignatureManifest with paths to generated stubs.
    """
    design_path = workspace / "openspec" / "design.md"
    if not design_path.exists():
        return SignatureManifest(stub_files=[], test_dir="tests", modules=[], interfaces=[])

    design_md = design_path.read_text(encoding="utf-8")
    modules = _parse_design_modules(design_md)
    interfaces = _parse_design_interfaces(design_md)

    if not interfaces:
        return SignatureManifest(stub_files=[], test_dir="tests", modules=modules, interfaces=interfaces)

    # Generate stub code
    stub_code = _generate_stub_code(interfaces)

    # Determine output path from modules or use default
    # Find the first module with a filePath, or use a default
    stub_path = None
    for mod in modules:
        fp = mod.get("filePath", "").strip()
        if fp:
            stub_path = workspace / fp
            break

    if stub_path is None:
        # Default: use project name from first module or "project"
        project_name = "project"
        if modules:
            name = modules[0].get("name", "").lower().replace(" ", "_")
            if name:
                project_name = name
        stub_dir = workspace / project_name
        stub_dir.mkdir(parents=True, exist_ok=True)
        stub_path = stub_dir / "stubs.py"

    # Ensure parent directory exists
    stub_path.parent.mkdir(parents=True, exist_ok=True)
    stub_path.write_text(stub_code, encoding="utf-8")

    # Create __init__.py if needed
    init_path = stub_path.parent / "__init__.py"
    if not init_path.exists():
        init_path.write_text("", encoding="utf-8")

    # Create tests directory
    test_dir = workspace / "tests"
    test_dir.mkdir(parents=True, exist_ok=True)

    stub_files = [str(stub_path.relative_to(workspace))]

    return SignatureManifest(
        stub_files=stub_files,
        test_dir="tests",
        modules=modules,
        interfaces=interfaces,
    )


# =============================================================================
# Agent prompts
# =============================================================================

TEST_AGENT_WRITE_PROMPT = """You are a test engineer. Write comprehensive pytest tests based on design documents and code stubs.

## Your Workflow
1. Read openspec/design.md and openspec/spec.md to understand requirements and interfaces
2. Read the stub files to understand function/class signatures
3. Write pytest test files in the tests/ directory
4. Include: unit tests for each interface, edge case tests, integration tests
5. Tests should import from the stub modules and test the public API

## Rules
- ONLY create/edit files under the tests/ directory
- Do NOT implement any production code
- Write tests that will initially FAIL (stubs raise NotImplementedError)
- Use descriptive test names: test_<feature>_<scenario>
- Include both happy-path and error-handling tests
- Use pytest fixtures where appropriate

When done, call finish with a summary of test files created.
"""

TDD_CODE_AGENT_PROMPT = """You are an expert developer. Implement code to make all tests pass.

## Your Workflow
1. Read the test files in tests/ to understand expected behavior
2. Read the stub files to understand the required signatures
3. Read openspec/design.md for architecture context
4. Implement the code — fill in the stubs to make ALL tests pass
5. Run `pytest tests/ -v` after each significant change
6. Fix failures iteratively until all tests pass

## Rules
- Do NOT modify any files in the tests/ directory
- Do NOT change function/class signatures — they are contracts
- Run `pytest tests/ -v` to check progress
- Keep implementations clean and follow the design document
- Handle edge cases as specified in the tests

When done, call finish with a summary of what was implemented and test results.
"""

BLACKBOX_TEST_AGENT_PROMPT = """You are a black-box test engineer. Write executable pytest tests based ONLY on specification scenarios.

## Your Workflow
1. Read openspec/spec.md to understand the Given/When/Then scenarios
2. Read the implementation code to understand how to import and call the public API
3. Write a single test file: tests/test_blackbox_auto.py
4. Each scenario becomes one test function: test_tc_001, test_tc_002, etc.
5. Tests must be REAL executable tests with actual assertions — NOT stubs or skips

## Rules
- ONLY create/edit files under the tests/ directory
- Test from the USER's perspective — treat the code as a black box
- Import the actual modules and call the real API
- Each test must have real assertions that verify the Then condition
- Do NOT use pytest.skip() — every test must run and assert something

When done, call finish with a summary of tests created.
"""

TEST_AGENT_VERIFY_PROMPT = """You are a test verification agent. Run tests and analyze results.

## Your Workflow
1. Run `pytest tests/ -v --tb=long` to execute all tests
2. Read implementation code to verify it matches the design
3. Analyze the results carefully
4. Report: which tests pass, which fail, and why

## Rules
- You CANNOT modify any files — you are read-only
- Focus on accurate reporting of test results
- Include the full pytest output in your report
- If tests fail, provide a clear failure analysis for the developer

When done, call finish with the complete test results and analysis.
"""


# =============================================================================
# Agent creation
# =============================================================================

def create_test_agent_write(llm: LLM) -> Agent:
    """Create Test Agent in write mode — can only write under tests/."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "test_file_editor"},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": TEST_AGENT_WRITE_PROMPT},
    )


def create_code_agent(llm: LLM) -> Agent:
    """Create Code Agent — can write everywhere except tests/."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "code_file_editor"},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": TDD_CODE_AGENT_PROMPT},
    )


def create_blackbox_test_agent(llm: LLM) -> Agent:
    """Create agent to write real blackbox tests from spec.md scenarios."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "test_file_editor"},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": BLACKBOX_TEST_AGENT_PROMPT},
    )


def create_test_agent_verify(llm: LLM) -> Agent:
    """Create Test Agent in verify mode — read + run only, no file writes."""
    return Agent(
        llm=llm,
        tools=[
            {"name": FileReadTool.name},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": TEST_AGENT_VERIFY_PROMPT},
    )


# =============================================================================
# Pytest output parser
# =============================================================================

def parse_pytest_output(output: str) -> TestRunResult:
    """Parse pytest output to extract pass/fail counts."""
    # Match summary line like "5 passed, 2 failed, 1 error"
    passed = 0
    failed = 0
    errors = 0

    # Try the summary line pattern
    summary_match = re.search(
        r"(\d+)\s+passed", output
    )
    if summary_match:
        passed = int(summary_match.group(1))

    fail_match = re.search(r"(\d+)\s+failed", output)
    if fail_match:
        failed = int(fail_match.group(1))

    error_match = re.search(r"(\d+)\s+error", output)
    if error_match:
        errors = int(error_match.group(1))

    total = passed + failed + errors
    all_passed = total > 0 and failed == 0 and errors == 0

    return TestRunResult(
        all_passed=all_passed,
        total=total,
        passed=passed,
        failed=failed,
        errors=errors,
        output=output,
    )


def _extract_test_output_from_conversation(conversation: Conversation) -> str:
    """Extract pytest output from conversation events.

    Walks the event log looking for:
    1. Terminal ObservationEvents containing pytest output
    2. The FinishAction message as fallback
    """
    from openhands.sdk.event import ActionEvent, ObservationEvent
    from openhands.sdk.tool.builtins.finish import FinishAction

    terminal_outputs: list[str] = []
    finish_message = ""

    try:
        for event in conversation.state.events:
            # Terminal observation — contains command output
            if isinstance(event, ObservationEvent) and event.tool_name == "terminal":
                for item in event.observation.content:
                    text = getattr(item, "text", "")
                    if text:
                        terminal_outputs.append(text)

            # Finish action — agent's final summary
            if isinstance(event, ActionEvent) and isinstance(event.action, FinishAction):
                finish_message = event.action.message or ""
    except Exception:
        pass

    # Prefer terminal output that contains pytest summary lines
    pytest_outputs = [
        t for t in terminal_outputs
        if "passed" in t or "failed" in t or "error" in t
    ]

    if pytest_outputs:
        return "\n".join(pytest_outputs)

    # Fallback: all terminal output
    if terminal_outputs:
        return "\n".join(terminal_outputs)

    # Last resort: the finish message may contain test results
    if finish_message:
        return finish_message

    return "No pytest output captured"


# =============================================================================
# Phase 5: Black-box test generation from spec.md
# =============================================================================

def generate_blackbox_tests(workspace: Path) -> Path | None:
    """Generate pytest black-box tests from spec.md Given/When/Then scenarios.

    Returns path to generated test file, or None if no spec.md found.
    """
    spec_path = workspace / "openspec" / "spec.md"
    if not spec_path.exists():
        return None

    spec_md = spec_path.read_text(encoding="utf-8")
    scenarios = _parse_spec_scenarios(spec_md)

    if not scenarios:
        return None

    lines = [
        '"""Auto-generated black-box tests from spec.md scenarios."""',
        "",
        "import pytest",
        "",
        "# NOTE: These tests are generated from Given/When/Then scenarios.",
        "# The test bodies are intentionally left as stubs — the Test Agent",
        "# or Code Agent should fill them in based on the scenario descriptions.",
        "",
    ]

    for scenario in scenarios:
        func_name = _scenario_to_func_name(scenario["id"])
        lines.append(f"def {func_name}():")
        lines.append(f'    """')
        lines.append(f'    {scenario["name"]}')
        lines.append(f'    Given: {scenario["given"]}')
        lines.append(f'    When: {scenario["when"]}')
        lines.append(f'    Then: {scenario["then"]}')
        lines.append(f'    """')
        lines.append(f'    # TODO: Implement based on scenario')
        lines.append(f'    pytest.skip("Black-box test not yet implemented")')
        lines.append("")

    test_dir = workspace / "tests"
    test_dir.mkdir(parents=True, exist_ok=True)
    test_file = test_dir / "test_blackbox_auto.py"
    test_file.write_text("\n".join(lines), encoding="utf-8")
    return test_file


def _parse_spec_scenarios(spec_md: str) -> list[dict[str, str]]:
    """Parse Given/When/Then scenarios from spec.md."""
    scenarios: list[dict[str, str]] = []
    lines = spec_md.split("\n")
    current: dict[str, str] = {}

    for line in lines:
        stripped = line.strip()
        # Match "## TC-001: Name"
        if stripped.startswith("## "):
            if current:
                scenarios.append(current)
            header = stripped[3:].strip()
            parts = header.split(":", 1)
            current = {
                "id": parts[0].strip(),
                "name": parts[1].strip() if len(parts) > 1 else header,
                "given": "",
                "when": "",
                "then": "",
            }
        elif stripped.startswith("**Given:**"):
            if current:
                current["given"] = stripped.replace("**Given:**", "").strip()
        elif stripped.startswith("**When:**"):
            if current:
                current["when"] = stripped.replace("**When:**", "").strip()
        elif stripped.startswith("**Then:**"):
            if current:
                current["then"] = stripped.replace("**Then:**", "").strip()

    if current:
        scenarios.append(current)

    return scenarios


def _scenario_to_func_name(scenario_id: str) -> str:
    """Convert scenario ID to a valid pytest function name."""
    # "TC-001" -> "test_tc_001"
    name = scenario_id.lower().replace("-", "_").replace(" ", "_")
    if not name.startswith("test_"):
        name = f"test_{name}"
    return name


# =============================================================================
# Main orchestrator
# =============================================================================

def run_tdd_pipeline(
    workspace: str | Path,
    llm: LLM | None = None,
    language: str = "python",
    mode: str = "create",
    project_id: str | None = None,
    change_request: str | None = None,
) -> TDDResult:
    """Run the TDD pipeline: signatures → tests → code → verify.

    Args:
        workspace: Directory containing openspec/ design documents
        llm: LLM instance (created from config if not provided)
        language: Target language
        mode: "create" for greenfield, "modify" for brownfield
        project_id: Project ID for loading architecture (modify mode)
        change_request: Description of changes (modify mode)

    Returns:
        TDDResult with full pipeline results
    """
    from toyshop import create_toyshop_llm

    if llm is None:
        llm = create_toyshop_llm()

    workspace = Path(workspace)

    # ── Phase 1: Signature Extraction ──
    print("[TDD] Phase 1: Signature Extraction")
    manifest = extract_signatures(workspace)
    print(f"  Stubs: {manifest.stub_files}")
    print(f"  Interfaces: {len(manifest.interfaces)}")

    if not manifest.interfaces:
        return TDDResult(
            success=False,
            stub_files=manifest.stub_files,
            summary="No interfaces found in design.md — cannot generate stubs",
        )

    # ── Phase 2: Test Generation ──
    print("[TDD] Phase 2: Test Generation (Test Agent — write mode)")
    test_agent = create_test_agent_write(llm)
    test_conv = Conversation(agent=test_agent, workspace=str(workspace))

    stub_list = "\n".join(f"  - {f}" for f in manifest.stub_files)
    test_conv.send_message(
        f"Write comprehensive pytest tests for this project.\n\n"
        f"Design documents are in openspec/ directory.\n"
        f"Stub files with signatures:\n{stub_list}\n\n"
        f"Create test files in the tests/ directory."
    )
    test_conv.run()

    # Collect test files
    test_dir = workspace / "tests"
    test_files = sorted(
        str(f.relative_to(workspace))
        for f in test_dir.rglob("test_*.py")
        if f.name != "test_blackbox_auto.py"
    )
    print(f"  Test files created: {test_files}")

    if not test_files:
        return TDDResult(
            success=False,
            stub_files=manifest.stub_files,
            summary="Test Agent produced no test files",
        )

    # ── Phase 5 (early): Check if spec.md has scenarios for black-box ──
    spec_path = workspace / "openspec" / "spec.md"
    has_spec_scenarios = spec_path.exists() and _parse_spec_scenarios(
        spec_path.read_text(encoding="utf-8")
    )
    if has_spec_scenarios:
        print("[TDD] spec.md has scenarios — black-box tests will be generated after white-box passes")
    else:
        print("[TDD] No spec.md scenarios found, skipping black-box tests")

    # ── Retry loop: Phase 3 → Phase 4 → Phase 5 ──
    retry_count = 0
    whitebox_passed = False
    blackbox_passed = False
    whitebox_output = ""
    blackbox_output = ""
    failure_context = ""
    bb_test_file: Path | None = None

    while retry_count < MAX_TOTAL_RETRIES:
        # ── Phase 3: Code Implementation ──
        print(f"[TDD] Phase 3: Code Implementation (attempt {retry_count + 1})")
        code_agent = create_code_agent(llm)
        code_conv = Conversation(agent=code_agent, workspace=str(workspace))

        code_prompt = (
            f"Implement the code to make all tests pass.\n\n"
            f"Design documents: openspec/\n"
            f"Stub files: {stub_list}\n"
            f"Test files: {', '.join(test_files)}\n\n"
            f"Run `pytest tests/ -v` to verify your implementation."
        )
        if failure_context:
            code_prompt += f"\n\n## Previous test failures:\n{failure_context}"

        code_conv.send_message(code_prompt)
        code_conv.run()

        # ── Phase 4: White-box Verification ──
        print("[TDD] Phase 4: White-box Verification")
        wb_agent = create_test_agent_verify(llm)
        wb_conv = Conversation(agent=wb_agent, workspace=str(workspace))
        wb_conv.send_message(
            "Run all white-box tests and report results.\n\n"
            "Execute: `pytest tests/ -v --tb=long --ignore=tests/test_blackbox_auto.py`\n\n"
            "Report the full output and whether all tests passed."
        )
        wb_conv.run()

        whitebox_output = _extract_test_output_from_conversation(wb_conv)
        wb_result = parse_pytest_output(whitebox_output)
        print(f"  White-box: {wb_result.passed} passed, {wb_result.failed} failed, {wb_result.errors} errors")

        if not wb_result.all_passed:
            failure_context = f"White-box test failures:\n{whitebox_output}"
            retry_count += 1
            if retry_count >= MAX_WHITEBOX_RETRIES:
                print(f"  White-box retries exhausted ({MAX_WHITEBOX_RETRIES})")
                break
            continue

        whitebox_passed = True

        # ── Phase 5: Black-box Tests ──
        if has_spec_scenarios:
            # Phase 5a: Generate real blackbox tests using an agent
            print("[TDD] Phase 5a: Black-box Test Generation (agent writes from spec.md)")
            bb_write_agent = create_blackbox_test_agent(llm)
            bb_write_conv = Conversation(agent=bb_write_agent, workspace=str(workspace))
            bb_write_conv.send_message(
                "Write executable black-box tests from the spec.md scenarios.\n\n"
                "Read openspec/spec.md for the Given/When/Then scenarios.\n"
                "Read the implementation code to understand how to import modules.\n\n"
                "Create tests/test_blackbox_auto.py with one test per scenario.\n"
                "Each test must have REAL assertions — no pytest.skip().\n"
                "Run `pytest tests/test_blackbox_auto.py -v` to verify they pass."
            )
            bb_write_conv.run()

            bb_test_file = workspace / "tests" / "test_blackbox_auto.py"

            # Phase 5b: Verify blackbox tests
            if bb_test_file.exists():
                print("[TDD] Phase 5b: Black-box Verification")
                bb_verify_agent = create_test_agent_verify(llm)
                bb_verify_conv = Conversation(agent=bb_verify_agent, workspace=str(workspace))
                bb_verify_conv.send_message(
                    "Run the black-box tests and report results.\n\n"
                    "Execute: `pytest tests/test_blackbox_auto.py -v --tb=long`\n\n"
                    "Report the full output and whether all tests passed."
                )
                bb_verify_conv.run()

                blackbox_output = _extract_test_output_from_conversation(bb_verify_conv)
                bb_result = parse_pytest_output(blackbox_output)
                print(f"  Black-box: {bb_result.passed} passed, {bb_result.failed} failed, {bb_result.errors} errors")

                if not bb_result.all_passed and bb_result.failed > 0:
                    failure_context = f"Black-box test failures:\n{blackbox_output}"
                    retry_count += 1
                    if retry_count >= MAX_TOTAL_RETRIES:
                        print(f"  Total retries exhausted ({MAX_TOTAL_RETRIES})")
                        break
                    continue

        blackbox_passed = True
        break

    # ── Collect results ──
    files_created = []
    for f in workspace.rglob("*"):
        if f.is_file():
            rel = f.relative_to(workspace)
            if not str(rel).startswith((".toyshop", "openspec", "__pycache__", ".git")):
                files_created.append(str(rel))

    all_test_files = sorted(
        str(f.relative_to(workspace)) for f in test_dir.rglob("test_*.py")
    )

    success = whitebox_passed and blackbox_passed
    summary_parts = [
        f"TDD pipeline {'PASSED' if success else 'FAILED'}",
        f"White-box: {'PASSED' if whitebox_passed else 'FAILED'}",
        f"Black-box: {'PASSED' if blackbox_passed else 'SKIPPED' if not has_spec_scenarios else 'FAILED'}",
        f"Retries: {retry_count}",
    ]

    return TDDResult(
        success=success,
        files_created=files_created,
        test_files=all_test_files,
        stub_files=manifest.stub_files,
        whitebox_passed=whitebox_passed,
        blackbox_passed=blackbox_passed,
        whitebox_output=whitebox_output,
        blackbox_output=blackbox_output,
        summary=" | ".join(summary_parts),
        retry_count=retry_count,
    )
