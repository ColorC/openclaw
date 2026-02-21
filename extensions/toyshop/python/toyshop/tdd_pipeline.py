"""TDD Pipeline - Test-Driven Development with permission-isolated agents.

Pipeline flow:
  Phase 1: Signature Extraction (pure Python, no agent)
  Phase 2: Test Generation (Test Agent - write mode, restricted to tests/)
  Phase 3: Code Implementation (Code Agent - blocked from tests/)
  Phase 3.5: Test Fix (Test Agent - fix mode, if code agent hit boundary violation)
  Phase 4: White-box Verification (Test Agent - verify mode, read-only)
  Phase 4.5: Debug Analysis (Debug Agent - probes, fault localization, hypotheses)
  Phase 5: Black-box Verification (auto-generated from spec.md scenarios)
  Phase 6: Final Report (legacy issues, debug history)

Key design: agents have different tool permissions enforced at the executor level,
not just via prompt instructions. Debug Agent uses hypothesis-driven debugging with
diagnostic probes and SBFL fault localization.

Cross-boundary violations: when an agent tries to edit files outside its allowed
directories, the violation is detected and the request is re-routed to the
appropriate agent (e.g., code agent -> test fix agent for test bugs).
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field, asdict
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

# Debug subsystems
from toyshop.rollback import RollbackManager
from toyshop.debug_probe import get_instrumentor, reset_probe_counter
from toyshop.fault_localize import FaultLocalizer, SuspiciousLine
from toyshop.debug_hypothesis import (
    DebugHypothesis,
    DebugReport,
    CodingChallenge,
    ProbeEvidence,
    get_hypothesis_manager,
    parse_challenge_from_finish,
)
from toyshop.test_combination import (
    expose_as_whitebox,
    generate_variant_tests_for_failures,
)
from toyshop.expected_comparison import (
    TestVerdict,
    LegacyIssue,
    mark_as_legacy,
)

# Import tools to trigger registration of new tools
import toyshop.debug_probe  # noqa: F401 — registers probe_tool
import toyshop.fault_localize  # noqa: F401 — registers fault_localize
import toyshop.debug_hypothesis  # noqa: F401 — registers hypothesis_tool

if TYPE_CHECKING:
    from openhands.sdk.conversation import LocalConversation
    from openhands.sdk.conversation.state import ConversationState


# =============================================================================
# Constants
# =============================================================================

MAX_WHITEBOX_RETRIES = 3
MAX_BLACKBOX_RETRIES = 2
MAX_TOTAL_RETRIES = 5
MAX_CHALLENGE_RETRIES = 2  # max times Coding Agent can challenge hypotheses


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
    # Debug enhancement fields
    legacy_issues: list[LegacyIssue] = field(default_factory=list)
    debug_reports: list[DebugReport] = field(default_factory=list)
    verdicts: list[TestVerdict] = field(default_factory=list)


@dataclass
class BoundaryViolation:
    """Detected when an agent tries to write outside its allowed directories."""
    agent_role: str       # "code" or "test"
    target_path: str      # file the agent tried to edit
    agent_reasoning: str  # finish message explaining why


def _detect_boundary_violations(
    conversation: Conversation, agent_role: str,
) -> list[BoundaryViolation]:
    """Scan conversation events for blocked write operations.

    Returns a list of BoundaryViolation if the agent tried to edit files
    outside its allowed directories (detected via FileEditorObservation errors).
    """
    from openhands.sdk.event import ObservationEvent

    violations: list[BoundaryViolation] = []
    seen_paths: set[str] = set()

    finish_msg = _extract_finish_message(conversation)

    for event in conversation.state.events:
        if not isinstance(event, ObservationEvent):
            continue
        # Check for blocked write error messages from DirectoryRestrictedFileEditorExecutor
        text = ""
        if hasattr(event, "observation") and hasattr(event.observation, "content"):
            for item in event.observation.content:
                if hasattr(item, "text"):
                    text += item.text
        if not text:
            continue
        # Match: "Write operation 'xxx' blocked on '/path/to/file'."
        m = re.search(r"Write operation '[^']+' blocked on '([^']+)'", text)
        if m:
            path = m.group(1)
            if path not in seen_paths:
                seen_paths.add(path)
                violations.append(BoundaryViolation(
                    agent_role=agent_role,
                    target_path=path,
                    agent_reasoning=finish_msg[:2000],
                ))

    return violations


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
- If you believe IMPLEMENTATION CODE has a bug, do NOT try to edit it.
  Instead, explain in your finish message what is wrong and why.
  The system will route your request to the coding agent for fixing.

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
- If you believe a TEST has a bug (wrong data, contradictory logic), do NOT try to edit it.
  Instead, explain in your finish message what is wrong with the test and why.
  The system will route your request to the test agent for fixing.

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
- If you believe IMPLEMENTATION CODE has a bug, do NOT try to edit it.
  Instead, explain in your finish message what is wrong and why.
  The system will route your request to the coding agent for fixing.

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

TDD_CODE_AGENT_WITH_DEBUG_PROMPT = """You are an expert developer. Implement code to make all tests pass.

You have received a Debug Report with hypotheses about the bug. Follow these hypotheses.

## Your Workflow
1. Read the Debug Report carefully — it contains fault localization and hypotheses
2. Focus on CONFIRMED hypotheses first, then SUSPICIOUS ones
3. Implement fixes based on the hypotheses
4. Run `pytest tests/ -v` after each fix
5. If your fix doesn't work and you believe a hypothesis is WRONG:
   Output in your finish message: [CHALLENGE:hyp_XXX] reason: <why the hypothesis is wrong>
   [EVIDENCE] <code or output that proves the hypothesis wrong>

## Rules
- Do NOT modify any files in the tests/ directory
- Do NOT change function/class signatures
- Address the hypotheses — don't ignore them
- If you challenge a hypothesis, provide CLEAR evidence
- If you believe a TEST has a bug (wrong data, contradictory logic), do NOT try to edit it.
  Instead, explain in your finish message what is wrong with the test and why.
  The system will route your request to the test agent for fixing.

When done, call finish with a summary and test results.
"""

DEBUG_AGENT_PROMPT = """You are a debug analyst. Analyze test failures using scientific debugging.

## Your Tools
- `fault_localize`: Run SBFL fault localization to rank suspicious code lines
- `probe_tool`: Insert diagnostic probes into source code
  - insert_trace: non-interrupting log (program runs to completion)
  - insert_halt: interrupting breakpoint (program exits at that point with code 99)
  - remove_all: restore all files to original state
  - collect: parse probe output from test run
- `hypothesis_tool`: Manage debug hypotheses
  - create: propose a new hypothesis
  - update: change status (confirmed/excluded/suspicious)
  - add_evidence: attach probe evidence to a hypothesis
- `terminal`: Run tests to collect probe output
- `FileReadTool`: Read source code

## Your Workflow
1. Run `fault_localize` with command="localize" to get suspicious line ranking
2. Read the suspicious code and the failing test output
3. Create 1-3 hypotheses about the bug cause using `hypothesis_tool`
4. For each hypothesis:
   a. Insert trace probes at suspicious locations using `probe_tool`
   b. Run the failing test: `pytest <test_file>::<test_name> -v -s 2>&1`
   c. Collect probe output using `probe_tool` command="collect"
   d. Add evidence to the hypothesis using `hypothesis_tool`
   e. Update hypothesis status based on evidence
   f. If needed, insert halt probes to narrow down further
5. After investigation, remove all probes: `probe_tool` command="remove_all"
6. Generate final report: `hypothesis_tool` command="report"

## Hypothesis Status Guide
- confirmed: Evidence clearly supports this is the bug cause
- excluded: Evidence proves this is NOT the cause
- suspicious: Evidence is inconclusive, needs more investigation

## Rules
- You CANNOT edit business code — only insert probes
- ALWAYS remove all probes before finishing
- Be systematic: one hypothesis at a time
- Provide clear reasoning for each status change

When done, call finish with your analysis summary.
"""

TEST_AGENT_FIX_PROMPT = """You are a test engineer. Fix test issues identified by debug analysis.

## Context
The debug analysis found that certain test failures are caused by issues in the
test code itself, not in the implementation. The coding agent attempted to fix
the tests but was blocked because it cannot edit files under tests/.

## Your Workflow
1. Read the Debug Report and boundary violation context carefully
2. Read the affected test files and the implementation code
3. Fix the test issues — preserve the TEST INTENT but fix the test DATA or LOGIC
4. Run `pytest tests/ -v` to verify your fixes don't break other tests
5. Do NOT modify any files outside the tests/ directory
6. Do NOT weaken tests — fix bugs in test data/logic, don't remove assertions

When done, call finish with a summary of what was fixed.
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


def create_test_agent_fix(llm: LLM) -> Agent:
    """Create Test Agent in fix mode — can edit tests/ to fix test bugs."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "test_file_editor"},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": TEST_AGENT_FIX_PROMPT},
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


def create_debug_agent(llm: LLM) -> Agent:
    """Create Debug Agent — probes + fault localization + hypotheses, read-only for code."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "probe_tool"},
            {"name": "fault_localize"},
            {"name": "hypothesis_tool"},
            {"name": FileReadTool.name},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": DEBUG_AGENT_PROMPT},
    )


def create_code_agent_with_debug(llm: LLM) -> Agent:
    """Create Code Agent that receives debug hypotheses."""
    return Agent(
        llm=llm,
        tools=[
            {"name": "code_file_editor"},
            {"name": "terminal"},
            {"name": "glob"},
            {"name": "grep"},
        ],
        include_default_tools=["FinishTool"],
        system_prompt_kwargs={"custom_prompt": TDD_CODE_AGENT_WITH_DEBUG_PROMPT},
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
    log_dir: Path | None = None,
) -> TDDResult:
    """Run the TDD pipeline: signatures → tests → code → verify.

    Args:
        workspace: Directory containing openspec/ design documents
        llm: LLM instance (created from config if not provided)
        language: Target language
        mode: "create" for greenfield, "modify" for brownfield
        project_id: Project ID for loading architecture (modify mode)
        change_request: Description of changes (modify mode)
        log_dir: If set, save agent conversation logs to this directory

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
    if log_dir:
        _save_agent_log(test_conv, log_dir, "phase2_test")

    # Check if test agent tried to edit business code
    test_violations = _detect_boundary_violations(test_conv, "test")
    if test_violations:
        code_paths = [v.target_path for v in test_violations]
        print(f"  [BOUNDARY] Test agent attempted to edit code file(s): {code_paths}")

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

    # ── Retry loop: Phase 3 → Phase 4 → Phase 4.5 → Phase 5 ──
    retry_count = 0
    whitebox_passed = False
    blackbox_passed = False
    whitebox_output = ""
    blackbox_output = ""
    debug_report: DebugReport | None = None
    challenge: CodingChallenge | None = None
    challenge_count = 0
    all_debug_reports: list[DebugReport] = []
    all_legacy_issues: list[LegacyIssue] = []
    all_attempts: list[str] = []
    bb_test_file: Path | None = None

    # Initialize rollback manager
    rollback = RollbackManager(workspace)
    rollback.checkpoint("pipeline_start")

    while retry_count < MAX_TOTAL_RETRIES:
        # ── Phase 3: Code Implementation ──
        print(f"[TDD] Phase 3: Code Implementation (attempt {retry_count + 1})")
        pre_code_checkpoint = rollback.checkpoint("phase3_start")

        if debug_report:
            # Use debug-aware code agent
            code_agent = create_code_agent_with_debug(llm)
            code_conv = Conversation(agent=code_agent, workspace=str(workspace))
            code_prompt = (
                f"Implement the code to make all tests pass.\n\n"
                f"Design documents: openspec/\n"
                f"Stub files: {stub_list}\n"
                f"Test files: {', '.join(test_files)}\n\n"
                f"{debug_report.to_prompt_text()}\n\n"
                f"Run `pytest tests/ -v` to verify your implementation."
            )
        else:
            code_agent = create_code_agent(llm)
            code_conv = Conversation(agent=code_agent, workspace=str(workspace))
            code_prompt = (
                f"Implement the code to make all tests pass.\n\n"
                f"Design documents: openspec/\n"
                f"Stub files: {stub_list}\n"
                f"Test files: {', '.join(test_files)}\n\n"
                f"Run `pytest tests/ -v` to verify your implementation."
            )

        code_conv.send_message(code_prompt)
        code_conv.run()
        if log_dir:
            _save_agent_log(code_conv, log_dir, f"phase3_code_attempt{retry_count + 1}")

        # Extract finish message to check for challenges
        finish_msg = _extract_finish_message(code_conv)
        all_attempts.append(f"Attempt {retry_count + 1}: {finish_msg[:200]}")

        rollback.checkpoint("phase3_end")

        # Check if Coding Agent challenged a hypothesis
        if debug_report and finish_msg:
            challenge = parse_challenge_from_finish(finish_msg)
            if challenge:
                print(f"  [CHALLENGE] Coding Agent challenges {challenge.hypothesis_id}: {challenge.challenge_reason}")
                challenge_count += 1
                if challenge_count <= MAX_CHALLENGE_RETRIES:
                    # Rollback code changes
                    rollback.rollback_to(pre_code_checkpoint)
                    print(f"  Rolled back to pre-code checkpoint")
                    # Re-run debug with challenge context
                    debug_report = _run_debug_analysis(
                        workspace, llm, whitebox_output, challenge, all_debug_reports
                    )
                    continue
                else:
                    print(f"  Challenge retries exhausted ({MAX_CHALLENGE_RETRIES})")

        # ── Phase 3.5: Boundary violation detection ──
        # If code agent tried to edit tests/, re-route to test fix agent
        violations = _detect_boundary_violations(code_conv, "code")
        if violations:
            test_paths = [v.target_path for v in violations]
            print(f"  [BOUNDARY] Code agent attempted to edit test file(s): {test_paths}")
            print("[TDD] Phase 3.5: Test Fix (re-routing to test agent)")

            test_fix_agent = create_test_agent_fix(llm)
            test_fix_conv = Conversation(agent=test_fix_agent, workspace=str(workspace))

            violation_context = "\n".join(
                f"- Tried to edit: {v.target_path}" for v in violations
            )
            fix_prompt = (
                f"Fix test issues identified by debug analysis.\n\n"
                f"## Debug Report\n"
                f"{debug_report.to_prompt_text() if debug_report else 'No debug report available.'}\n\n"
                f"## What the coding agent wanted to change\n{violation_context}\n\n"
                f"## Coding agent's reasoning\n{finish_msg[:2000]}\n\n"
                f"Design documents: openspec/\n"
                f"Run `pytest tests/ -v` to verify after fixing."
            )
            test_fix_conv.send_message(fix_prompt)
            test_fix_conv.run()
            if log_dir:
                _save_agent_log(test_fix_conv, log_dir, f"phase3_5_testfix_attempt{retry_count + 1}")

        # ── Phase 4: White-box Verification ──
        print("[TDD] Phase 4: White-box Verification")
        wb_agent = create_test_agent_verify(llm)
        wb_conv = Conversation(agent=wb_agent, workspace=str(workspace))
        wb_conv.send_message(
            "Run all white-box tests and report results.\n\n"
            "Execute: `pytest tests/ -v --tb=long --ignore=tests/test_blackbox_auto.py "
            "--ignore=tests/test_whitebox_from_bb.py --ignore=tests/test_blackbox_variants.py`\n\n"
            "Report the full output and whether all tests passed."
        )
        wb_conv.run()
        if log_dir:
            _save_agent_log(wb_conv, log_dir, f"phase4_verify_attempt{retry_count + 1}")

        whitebox_output = _extract_test_output_from_conversation(wb_conv)
        wb_result = parse_pytest_output(whitebox_output)
        print(f"  White-box: {wb_result.passed} passed, {wb_result.failed} failed, {wb_result.errors} errors")

        if not wb_result.all_passed:
            retry_count += 1
            if retry_count >= MAX_WHITEBOX_RETRIES:
                print(f"  White-box retries exhausted ({MAX_WHITEBOX_RETRIES})")
                # Mark remaining failures as legacy issues
                _mark_legacy_issues(
                    whitebox_output, all_debug_reports, all_attempts, all_legacy_issues
                )
                break

            # ── Phase 4.5: Debug Analysis ──
            debug_report = _run_debug_analysis(
                workspace, llm, whitebox_output, challenge=None,
                all_debug_reports=all_debug_reports,
            )
            challenge = None
            challenge_count = 0
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
            if log_dir:
                _save_agent_log(bb_write_conv, log_dir, "phase5a_bb_write")

            # Check if blackbox test agent tried to edit business code
            bb_violations = _detect_boundary_violations(bb_write_conv, "test")
            if bb_violations:
                code_paths = [v.target_path for v in bb_violations]
                print(f"  [BOUNDARY] Blackbox test agent attempted to edit code file(s): {code_paths}")

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
                if log_dir:
                    _save_agent_log(bb_verify_conv, log_dir, "phase5b_bb_verify")

                blackbox_output = _extract_test_output_from_conversation(bb_verify_conv)
                bb_result = parse_pytest_output(blackbox_output)
                print(f"  Black-box: {bb_result.passed} passed, {bb_result.failed} failed, {bb_result.errors} errors")

                if not bb_result.all_passed and bb_result.failed > 0:
                    # ── BB/WB Combination: expose + anti-cheat ──
                    failing_bb_tests = _extract_failing_test_names(blackbox_output)
                    if failing_bb_tests:
                        print(f"  Exposing {len(failing_bb_tests)} BB tests as WB + generating variants")
                        wb_from_bb = workspace / "tests" / "test_whitebox_from_bb.py"
                        expose_as_whitebox(failing_bb_tests, bb_test_file, wb_from_bb)

                        # Generate anti-cheat variants
                        scenarios = _parse_spec_scenarios(
                            spec_path.read_text(encoding="utf-8")
                        )
                        variant_file = workspace / "tests" / "test_blackbox_variants.py"
                        generate_variant_tests_for_failures(
                            failing_bb_tests, bb_test_file, scenarios, llm, variant_file
                        )

                    # Run debug analysis for BB failures
                    retry_count += 1
                    if retry_count >= MAX_TOTAL_RETRIES:
                        print(f"  Total retries exhausted ({MAX_TOTAL_RETRIES})")
                        _mark_legacy_issues(
                            blackbox_output, all_debug_reports, all_attempts, all_legacy_issues
                        )
                        break

                    debug_report = _run_debug_analysis(
                        workspace, llm, blackbox_output, challenge=None,
                        all_debug_reports=all_debug_reports,
                    )
                    challenge = None
                    challenge_count = 0
                    continue

        blackbox_passed = True
        break

    # ── Collect results ──
    files_created = []
    for f in workspace.rglob("*"):
        if f.is_file():
            rel = f.relative_to(workspace)
            if not str(rel).startswith((".toyshop", "openspec", "__pycache__", ".git", ".coverage", ".tdd_debug")):
                files_created.append(str(rel))

    all_test_files = sorted(
        str(f.relative_to(workspace)) for f in test_dir.rglob("test_*.py")
    )

    success = whitebox_passed and blackbox_passed
    legacy_count = len(all_legacy_issues)
    summary_parts = [
        f"TDD pipeline {'PASSED' if success else 'FAILED'}",
        f"White-box: {'PASSED' if whitebox_passed else 'FAILED'}",
        f"Black-box: {'PASSED' if blackbox_passed else 'SKIPPED' if not has_spec_scenarios else 'FAILED'}",
        f"Retries: {retry_count}",
        f"Debug reports: {len(all_debug_reports)}",
    ]
    if legacy_count:
        summary_parts.append(f"Legacy issues: {legacy_count}")

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
        legacy_issues=all_legacy_issues,
        debug_reports=all_debug_reports,
    )


# =============================================================================
# Debug analysis helper (Phase 4.5)
# =============================================================================

def _run_debug_analysis(
    workspace: Path,
    llm: LLM,
    test_output: str,
    challenge: CodingChallenge | None,
    all_debug_reports: list[DebugReport],
) -> DebugReport:
    """Run Phase 4.5: Debug Agent analyzes failures with probes and hypotheses."""
    print("[TDD] Phase 4.5: Debug Analysis")

    # Reset probe and hypothesis state for this session
    instrumentor = get_instrumentor(workspace)
    instrumentor.remove_all_probes()
    reset_probe_counter()
    hyp_manager = get_hypothesis_manager(workspace)
    hyp_manager.reset()

    rollback = RollbackManager(workspace)
    rollback.checkpoint("debug_start")

    # Build debug prompt
    debug_prompt = (
        f"Analyze these test failures and identify the bug.\n\n"
        f"## Test Output\n```\n{test_output[:3000]}\n```\n\n"
    )
    if challenge:
        debug_prompt += (
            f"## IMPORTANT: Previous hypothesis was challenged\n"
            f"Hypothesis {challenge.hypothesis_id} was challenged by the developer.\n"
            f"Reason: {challenge.challenge_reason}\n"
            f"Evidence: {challenge.evidence}\n\n"
            f"You must investigate from a DIFFERENT angle. "
            f"Do NOT repeat the same hypothesis.\n\n"
        )

    debug_prompt += (
        "Use fault_localize, probe_tool, and hypothesis_tool to investigate.\n"
        "Remember to remove all probes before finishing."
    )

    debug_agent = create_debug_agent(llm)
    debug_conv = Conversation(agent=debug_agent, workspace=str(workspace))
    debug_conv.send_message(debug_prompt)
    debug_conv.run()

    # Ensure probes are cleaned up
    cleaned = instrumentor.remove_all_probes()
    if cleaned > 0:
        print(f"  Cleaned up {cleaned} probe-modified files")

    rollback.checkpoint("debug_end")

    # Build DebugReport from hypothesis manager state
    active, excluded = hyp_manager.get_report()
    finish_msg = _extract_finish_message(debug_conv)

    report = DebugReport(
        failing_tests=_extract_failing_test_names(test_output),
        test_output=test_output[:2000],
        hypotheses=active,
        excluded_hypotheses=excluded,
        recommended_fix=finish_msg[:1000] if finish_msg else "",
    )

    # Add fault localization data if available
    try:
        localizer = FaultLocalizer(workspace)
        suspicious = localizer.localize(top_n=10)
        report.fault_localization = [
            {"file": s.file, "line": s.line, "score": s.score}
            for s in suspicious
        ]
    except Exception:
        pass

    all_debug_reports.append(report)
    print(f"  Hypotheses: {len(active)} active, {len(excluded)} excluded")
    return report


def _extract_finish_message(conversation: Conversation) -> str:
    """Extract the finish message from a conversation."""
    from openhands.sdk.event import ActionEvent
    from openhands.sdk.tool.builtins.finish import FinishAction

    try:
        for event in conversation.state.events:
            if isinstance(event, ActionEvent) and isinstance(event.action, FinishAction):
                return event.action.message or ""
    except Exception:
        pass
    return ""


def _save_agent_log(
    conversation: Conversation, log_dir: Path, phase_name: str,
) -> None:
    """Save conversation events as a readable log file."""
    from openhands.sdk.event import ActionEvent, ObservationEvent

    log_dir.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    try:
        for event in conversation.state.events:
            if isinstance(event, ActionEvent):
                lines.append(f"[ACTION] {event.action.__class__.__name__}")
                if hasattr(event.action, "message") and event.action.message:
                    lines.append(f"  {event.action.message[:500]}")
            elif isinstance(event, ObservationEvent):
                text = ""
                if hasattr(event, "observation") and hasattr(event.observation, "content"):
                    for item in event.observation.content:
                        if hasattr(item, "text"):
                            text += item.text
                if text:
                    lines.append(f"[OBS] {text[:1000]}")
    except Exception:
        lines.append("[ERROR] Failed to extract some events")

    (log_dir / f"{phase_name}.log").write_text("\n".join(lines), encoding="utf-8")


def _extract_failing_test_names(test_output: str) -> list[str]:
    """Extract failing test names from pytest output."""
    failing = []
    for line in test_output.split("\n"):
        if "FAILED" in line:
            parts = line.strip().split()
            for part in parts:
                if "::" in part and "test_" in part:
                    func_name = part.split("::")[-1]
                    failing.append(func_name)
                    break
    return failing


def _mark_legacy_issues(
    test_output: str,
    debug_reports: list[DebugReport],
    attempts: list[str],
    legacy_issues: list[LegacyIssue],
) -> None:
    """Mark remaining test failures as legacy issues."""
    failing = _extract_failing_test_names(test_output)
    all_hypotheses: list[DebugHypothesis] = []
    for report in debug_reports:
        all_hypotheses.extend(report.hypotheses)
        all_hypotheses.extend(report.excluded_hypotheses)

    for test_name in failing:
        issue = mark_as_legacy(
            test_name=test_name,
            description=f"Test {test_name} failed after all retry attempts",
            attempts=attempts,
            hypotheses=all_hypotheses,
            recommendation="Requires manual investigation",
        )
        legacy_issues.append(issue)
