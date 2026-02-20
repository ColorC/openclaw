"""Hypothesis debug system for TDD pipeline.

Manages structured debug hypotheses with lifecycle:
  pending → confirmed | excluded | suspicious

Debug Agent creates hypotheses, collects evidence via probes,
and produces a DebugReport for the Coding Agent.
Coding Agent can challenge hypotheses via CodingChallenge.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Literal, TYPE_CHECKING

from openhands.sdk.tool import (
    ToolAnnotations,
    ToolDefinition,
    ToolExecutor,
    register_tool,
)
from openhands.sdk.tool.schema import Action, Observation

if TYPE_CHECKING:
    from openhands.sdk.conversation import LocalConversation
    from openhands.sdk.conversation.state import ConversationState
    from toyshop.fault_localize import SuspiciousLine


# =============================================================================
# Data models
# =============================================================================

@dataclass
class ProbeEvidence:
    """Evidence collected from a diagnostic probe."""
    probe_id: str
    output: str
    interpretation: str = ""


@dataclass
class DebugHypothesis:
    """A structured debugging hypothesis."""
    id: str
    description: str
    target_file: str = ""
    target_lines: list[int] = field(default_factory=list)
    status: Literal["pending", "confirmed", "excluded", "suspicious"] = "pending"
    evidence: list[ProbeEvidence] = field(default_factory=list)
    reasoning: str = ""


@dataclass
class DebugReport:
    """Complete debug report from Debug Agent to Coding Agent."""
    failing_tests: list[str] = field(default_factory=list)
    test_output: str = ""
    fault_localization: list[dict[str, Any]] = field(default_factory=list)
    hypotheses: list[DebugHypothesis] = field(default_factory=list)
    excluded_hypotheses: list[DebugHypothesis] = field(default_factory=list)
    recommended_fix: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)

    @classmethod
    def from_json(cls, text: str) -> "DebugReport":
        data = json.loads(text)
        report = cls(
            failing_tests=data.get("failing_tests", []),
            test_output=data.get("test_output", ""),
            fault_localization=data.get("fault_localization", []),
            recommended_fix=data.get("recommended_fix", ""),
        )
        for h in data.get("hypotheses", []):
            hyp = DebugHypothesis(**{k: v for k, v in h.items() if k != "evidence"})
            hyp.evidence = [ProbeEvidence(**e) for e in h.get("evidence", [])]
            report.hypotheses.append(hyp)
        for h in data.get("excluded_hypotheses", []):
            hyp = DebugHypothesis(**{k: v for k, v in h.items() if k != "evidence"})
            hyp.evidence = [ProbeEvidence(**e) for e in h.get("evidence", [])]
            report.excluded_hypotheses.append(hyp)
        return report

    def to_prompt_text(self) -> str:
        """Format as text for inclusion in agent prompts."""
        parts = ["## Debug Report"]
        if self.failing_tests:
            parts.append(f"\nFailing tests: {', '.join(self.failing_tests)}")
        if self.fault_localization:
            parts.append("\n### Suspicious Lines (SBFL)")
            for sl in self.fault_localization[:10]:
                parts.append(f"  - {sl.get('file', '?')}:{sl.get('line', '?')} (score={sl.get('score', 0)})")
        if self.hypotheses:
            parts.append("\n### Hypotheses")
            for h in self.hypotheses:
                parts.append(f"\n**{h.id}** [{h.status}]: {h.description}")
                if h.target_file:
                    parts.append(f"  Target: {h.target_file}:{h.target_lines}")
                if h.reasoning:
                    parts.append(f"  Reasoning: {h.reasoning}")
                for e in h.evidence:
                    parts.append(f"  Evidence ({e.probe_id}): {e.output}")
                    if e.interpretation:
                        parts.append(f"    → {e.interpretation}")
        if self.excluded_hypotheses:
            parts.append("\n### Excluded Hypotheses (for reference)")
            for h in self.excluded_hypotheses:
                parts.append(f"  - {h.id}: {h.description} — {h.reasoning}")
        if self.recommended_fix:
            parts.append(f"\n### Recommended Fix\n{self.recommended_fix}")
        return "\n".join(parts)


@dataclass
class CodingChallenge:
    """Coding Agent's challenge to a debug hypothesis."""
    hypothesis_id: str
    challenge_reason: str
    evidence: str = ""
    attempted_fixes: list[str] = field(default_factory=list)


def parse_challenge_from_finish(finish_message: str) -> CodingChallenge | None:
    """Parse [CHALLENGE:hyp_id] from Coding Agent's finish message."""
    import re
    m = re.search(r"\[CHALLENGE:(hyp_\d+)\]\s*reason:\s*(.+?)(?:\n|$)", finish_message, re.IGNORECASE)
    if not m:
        return None
    hyp_id = m.group(1)
    reason = m.group(2).strip()
    # Try to extract evidence
    evidence = ""
    ev_match = re.search(r"\[EVIDENCE\]\s*(.+?)(?:\n\[|$)", finish_message, re.DOTALL)
    if ev_match:
        evidence = ev_match.group(1).strip()
    return CodingChallenge(
        hypothesis_id=hyp_id,
        challenge_reason=reason,
        evidence=evidence,
    )


# =============================================================================
# Hypothesis manager (in-memory, per debug session)
# =============================================================================

class HypothesisManager:
    """Manages hypotheses for a single debug session."""

    def __init__(self):
        self._counter = 0
        self.hypotheses: list[DebugHypothesis] = []

    def create(self, description: str, target_file: str = "", target_lines: list[int] | None = None) -> DebugHypothesis:
        self._counter += 1
        hyp = DebugHypothesis(
            id=f"hyp_{self._counter:03d}",
            description=description,
            target_file=target_file,
            target_lines=target_lines or [],
        )
        self.hypotheses.append(hyp)
        return hyp

    def update(self, hyp_id: str, status: str, reasoning: str = "") -> DebugHypothesis | None:
        for h in self.hypotheses:
            if h.id == hyp_id:
                h.status = status  # type: ignore
                if reasoning:
                    h.reasoning = reasoning
                return h
        return None

    def add_evidence(self, hyp_id: str, evidence: ProbeEvidence) -> bool:
        for h in self.hypotheses:
            if h.id == hyp_id:
                h.evidence.append(evidence)
                return True
        return False

    def get_report(self) -> tuple[list[DebugHypothesis], list[DebugHypothesis]]:
        """Returns (active hypotheses, excluded hypotheses)."""
        active = [h for h in self.hypotheses if h.status != "excluded"]
        excluded = [h for h in self.hypotheses if h.status == "excluded"]
        return active, excluded

    def reset(self) -> None:
        self._counter = 0
        self.hypotheses.clear()


# =============================================================================
# Tool definition
# =============================================================================

class HypothesisAction(Action):
    command: Literal["create", "update", "add_evidence", "list", "report"]
    hypothesis_id: str | None = None
    description: str | None = None
    target_file: str | None = None
    target_lines: str | None = None  # comma-separated line numbers
    status: str | None = None
    reasoning: str | None = None
    # For add_evidence
    probe_id: str | None = None
    probe_output: str | None = None
    interpretation: str | None = None

    @property
    def visualize(self):
        from rich.text import Text
        return Text(f"hypothesis {self.command}")


class HypothesisObservation(Observation):
    pass


class HypothesisExecutor(ToolExecutor):
    def __init__(self, manager: HypothesisManager):
        self.manager = manager

    def __call__(
        self, action: HypothesisAction, conversation: "LocalConversation | None" = None
    ) -> HypothesisObservation:
        cmd = action.command

        if cmd == "create":
            if not action.description:
                return HypothesisObservation.from_text("Error: description required", is_error=True)
            lines = [int(x.strip()) for x in (action.target_lines or "").split(",") if x.strip().isdigit()]
            hyp = self.manager.create(action.description, action.target_file or "", lines)
            return HypothesisObservation.from_text(
                f"Created hypothesis {hyp.id}: {hyp.description}\n"
                f"Target: {hyp.target_file}:{hyp.target_lines}"
            )

        elif cmd == "update":
            if not action.hypothesis_id or not action.status:
                return HypothesisObservation.from_text("Error: hypothesis_id and status required", is_error=True)
            hyp = self.manager.update(action.hypothesis_id, action.status, action.reasoning or "")
            if not hyp:
                return HypothesisObservation.from_text(f"Hypothesis {action.hypothesis_id} not found", is_error=True)
            return HypothesisObservation.from_text(
                f"Updated {hyp.id} → status={hyp.status}, reasoning={hyp.reasoning}"
            )

        elif cmd == "add_evidence":
            if not action.hypothesis_id or not action.probe_id:
                return HypothesisObservation.from_text("Error: hypothesis_id and probe_id required", is_error=True)
            ev = ProbeEvidence(
                probe_id=action.probe_id,
                output=action.probe_output or "",
                interpretation=action.interpretation or "",
            )
            ok = self.manager.add_evidence(action.hypothesis_id, ev)
            if not ok:
                return HypothesisObservation.from_text(f"Hypothesis {action.hypothesis_id} not found", is_error=True)
            return HypothesisObservation.from_text(f"Added evidence from {ev.probe_id} to {action.hypothesis_id}")

        elif cmd == "list":
            if not self.manager.hypotheses:
                return HypothesisObservation.from_text("No hypotheses created yet")
            lines = []
            for h in self.manager.hypotheses:
                lines.append(f"  {h.id} [{h.status}]: {h.description}")
            return HypothesisObservation.from_text("Hypotheses:\n" + "\n".join(lines))

        elif cmd == "report":
            active, excluded = self.manager.get_report()
            report = DebugReport(hypotheses=active, excluded_hypotheses=excluded)
            return HypothesisObservation.from_text(report.to_prompt_text())

        return HypothesisObservation.from_text(f"Unknown command: {cmd}", is_error=True)


# =============================================================================
# Tool registration
# =============================================================================

_managers: dict[str, HypothesisManager] = {}


def get_hypothesis_manager(workspace: Path) -> HypothesisManager:
    key = str(workspace.resolve())
    if key not in _managers:
        _managers[key] = HypothesisManager()
    return _managers[key]


def _make_hypothesis_tool(
    conv_state: "ConversationState", **params: Any
) -> Sequence[ToolDefinition]:
    workspace = Path(conv_state.workspace.working_dir)
    manager = get_hypothesis_manager(workspace)
    executor = HypothesisExecutor(manager)

    class HypothesisTool(ToolDefinition):
        name = "hypothesis_tool"

        @classmethod
        def create(cls, *a: Any, **kw: Any) -> Sequence[ToolDefinition]:
            return []

    return [
        HypothesisTool(
            description=(
                "Manage debug hypotheses. Commands: "
                "create (new hypothesis), update (change status to confirmed/excluded/suspicious), "
                "add_evidence (attach probe evidence), list (show all), report (generate debug report)."
            ),
            action_type=HypothesisAction,
            observation_type=HypothesisObservation,
            executor=executor,
            annotations=ToolAnnotations(
                title="hypothesis_tool",
                readOnlyHint=False,
                destructiveHint=False,
                idempotentHint=False,
                openWorldHint=False,
            ),
        )
    ]


register_tool("hypothesis_tool", _make_hypothesis_tool)
