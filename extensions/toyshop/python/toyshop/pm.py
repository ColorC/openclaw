"""PM System — File-based project management with end-to-end pipeline.

Workflow:
  1. create_batch()        — create batch folder, save requirements.md
  2. run_spec_generation()  — requirement + architecture workflows → openspec docs
  3. prepare_tasks()        — parse tasks.md → create task folders
  4. run_task()             — copy openspec, run TDD pipeline, save logs
  5. run_batch()            — orchestrate 1-4 serially
  6. resume_batch()         — resume from last incomplete task
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from toyshop.llm import LLM, create_llm
from toyshop.workflows.requirement import run_requirement_workflow
from toyshop.workflows.architecture import run_architecture_workflow
from toyshop.tdd_pipeline import run_tdd_pipeline, TDDResult


# =============================================================================
# Data classes
# =============================================================================

@dataclass
class TaskState:
    id: str
    title: str
    description: str
    status: str = "pending"  # pending | in_progress | completed | failed | skipped
    dependencies: list[str] = field(default_factory=list)
    assigned_module: str | None = None
    task_dir: Path | None = None


@dataclass
class BatchState:
    batch_id: str
    project_name: str
    batch_dir: Path
    status: str = "pending"  # pending | in_progress | completed | failed
    tasks: list[TaskState] = field(default_factory=list)
    error: str | None = None


# =============================================================================
# Helpers
# =============================================================================
def _slugify(text: str, max_len: int = 30) -> str:
    """Convert text to a filesystem-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:max_len]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _save_progress(batch: BatchState) -> None:
    """Write progress.json for a batch."""
    completed = sum(1 for t in batch.tasks if t.status == "completed")
    failed = sum(1 for t in batch.tasks if t.status == "failed")
    current = next((t.id for t in batch.tasks if t.status == "in_progress"), None)
    _write_json(batch.batch_dir / "progress.json", {
        "batch_id": batch.batch_id,
        "project_name": batch.project_name,
        "status": batch.status,
        "total_tasks": len(batch.tasks),
        "completed_tasks": completed,
        "failed_tasks": failed,
        "current_task": current,
        "user_notes": "",
    })


def _save_task_json(task: TaskState) -> None:
    """Write task.json for a single task."""
    if task.task_dir is None:
        return
    data = {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "dependencies": task.dependencies,
        "assigned_module": task.assigned_module,
    }
    _write_json(task.task_dir / "task.json", data)


# =============================================================================
# Task parsing
# =============================================================================

def parse_tasks_md(text: str) -> list[dict[str, Any]]:
    """Parse tasks.md into a list of task dicts.

    Expected format (from openspec_bridge._tasks_to_markdown):
      ## 1. Top-level Title
      Description text

      ### 1.1 Subtask Title
      Description text
      **Dependencies:** 1.0, 1.1
      **Module:** parser
    """
    tasks: list[dict[str, Any]] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]

        # Match ## X. Title  or  ### X.Y Title
        m_top = re.match(r"^##\s+(\d+)\.\s+(.+)", line)
        m_sub = re.match(r"^###\s+([\d.]+)\s+(.+)", line)

        if m_top or m_sub:
            if m_top:
                task_id = m_top.group(1)
                title = m_top.group(2).strip()
            else:
                task_id = m_sub.group(1)
                title = m_sub.group(2).strip()

            # Collect description lines until next heading or metadata
            desc_lines: list[str] = []
            deps: list[str] = []
            module: str | None = None
            i += 1
            while i < len(lines):
                ln = lines[i]
                if ln.startswith("## ") or ln.startswith("### "):
                    break
                dep_m = re.match(r"\*\*Dependencies:\*\*\s*(.+)", ln)
                mod_m = re.match(r"\*\*Module:\*\*\s*(.+)", ln)
                if dep_m:
                    deps = [d.strip() for d in dep_m.group(1).split(",") if d.strip()]
                elif mod_m:
                    module = mod_m.group(1).strip()
                elif ln.strip():
                    desc_lines.append(ln.strip())
                i += 1

            tasks.append({
                "id": task_id,
                "title": title,
                "description": "\n".join(desc_lines),
                "dependencies": deps,
                "assigned_module": module,
            })
        else:
            i += 1

    return tasks


# =============================================================================
# Core functions
# =============================================================================

def create_batch(
    pm_root: str | Path,
    project_name: str,
    user_input: str,
) -> BatchState:
    """Create a new batch folder with requirements.md."""
    pm_root = Path(pm_root)
    pm_root.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = f"{timestamp}_{_slugify(project_name)}"
    batch_dir = pm_root / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    # Save raw requirements
    (batch_dir / "requirements.md").write_text(
        f"# Requirements: {project_name}\n\n{user_input}\n",
        encoding="utf-8",
    )

    batch = BatchState(
        batch_id=batch_id,
        project_name=project_name,
        batch_dir=batch_dir,
        status="pending",
    )
    _save_progress(batch)
    print(f"[PM] Created batch: {batch_dir}")
    return batch


def run_spec_generation(batch: BatchState, llm: LLM) -> BatchState:
    """Run requirement + architecture workflows, save openspec docs."""
    print("[PM] Running spec generation (requirement → architecture)")
    batch.status = "in_progress"
    _save_progress(batch)

    openspec_dir = batch.batch_dir / "openspec"
    openspec_dir.mkdir(exist_ok=True)

    # Requirement workflow
    req_state = run_requirement_workflow(
        llm=llm,
        user_input=(batch.batch_dir / "requirements.md").read_text(encoding="utf-8"),
        project_name=batch.project_name,
    )
    if req_state.error or req_state.current_step != "done":
        batch.status = "failed"
        batch.error = f"Requirement workflow failed: {req_state.error}"
        _save_progress(batch)
        return batch

    if req_state.proposal_markdown:
        (openspec_dir / "proposal.md").write_text(req_state.proposal_markdown, encoding="utf-8")
        print(f"  Saved proposal.md")

    # Architecture workflow
    arch_state = run_architecture_workflow(llm=llm, proposal=req_state.proposal)
    if arch_state.error or arch_state.current_step != "done":
        batch.status = "failed"
        batch.error = f"Architecture workflow failed: {arch_state.error}"
        _save_progress(batch)
        return batch

    if arch_state.design_markdown:
        (openspec_dir / "design.md").write_text(arch_state.design_markdown, encoding="utf-8")
        print(f"  Saved design.md")
    if arch_state.tasks_markdown:
        (openspec_dir / "tasks.md").write_text(arch_state.tasks_markdown, encoding="utf-8")
        print(f"  Saved tasks.md")
    if arch_state.spec_markdown:
        (openspec_dir / "spec.md").write_text(arch_state.spec_markdown, encoding="utf-8")
        print(f"  Saved spec.md")

    _save_progress(batch)
    return batch


def prepare_tasks(batch: BatchState) -> list[TaskState]:
    """Parse tasks.md and create task folders."""
    tasks_md_path = batch.batch_dir / "openspec" / "tasks.md"
    if not tasks_md_path.exists():
        print("[PM] No tasks.md found")
        return []

    raw_tasks = parse_tasks_md(tasks_md_path.read_text(encoding="utf-8"))
    print(f"[PM] Parsed {len(raw_tasks)} tasks from tasks.md")

    tasks_root = batch.batch_dir / "tasks"
    tasks_root.mkdir(exist_ok=True)

    task_states: list[TaskState] = []
    for t in raw_tasks:
        slug = _slugify(t["title"])
        task_dir = tasks_root / f"{t['id']}_{slug}"
        task_dir.mkdir(exist_ok=True)

        ts = TaskState(
            id=t["id"],
            title=t["title"],
            description=t["description"],
            dependencies=t.get("dependencies", []),
            assigned_module=t.get("assigned_module"),
            task_dir=task_dir,
        )
        _save_task_json(ts)
        task_states.append(ts)

    batch.tasks = task_states
    _save_progress(batch)
    return task_states


def run_task(batch: BatchState, task: TaskState, llm: LLM) -> TaskState:
    """Run TDD pipeline for a single task."""
    if task.task_dir is None:
        task.status = "failed"
        return task

    # Check dependencies
    completed_ids = {t.id for t in batch.tasks if t.status == "completed"}
    for dep in task.dependencies:
        if dep not in completed_ids:
            print(f"  [SKIP] Task {task.id} — dependency {dep} not completed")
            task.status = "skipped"
            _save_task_json(task)
            return task

    print(f"[PM] Running task {task.id}: {task.title}")
    task.status = "in_progress"
    _save_task_json(task)
    _save_progress(batch)

    # Prepare workspace
    workspace = task.task_dir / "workspace"
    workspace.mkdir(exist_ok=True)
    ws_openspec = workspace / "openspec"
    if ws_openspec.exists():
        shutil.rmtree(ws_openspec)
    shutil.copytree(batch.batch_dir / "openspec", ws_openspec)

    # Agent logs directory
    log_dir = task.task_dir / "agent_logs"
    log_dir.mkdir(exist_ok=True)

    # Run TDD pipeline
    try:
        result = run_tdd_pipeline(
            workspace=workspace,
            llm=llm,
            log_dir=log_dir,
        )
    except Exception as e:
        task.status = "failed"
        _save_task_json(task)
        _write_json(task.task_dir / "result.json", {"error": str(e)})
        return task

    # Save result
    task.status = "completed" if result.success else "failed"
    _save_task_json(task)
    _write_json(task.task_dir / "result.json", {
        "success": result.success,
        "whitebox_passed": result.whitebox_passed,
        "blackbox_passed": result.blackbox_passed,
        "retry_count": result.retry_count,
        "summary": result.summary,
        "files_created": result.files_created,
        "test_files": result.test_files,
    })
    _save_progress(batch)

    status_icon = "✓" if result.success else "✗"
    print(f"  [{status_icon}] Task {task.id} — {task.status}")
    return task


def run_batch(
    pm_root: str | Path,
    project_name: str,
    user_input: str,
    llm: LLM | None = None,
) -> BatchState:
    """End-to-end: create batch → generate specs → parse tasks → run each task."""
    if llm is None:
        llm = create_llm()

    # Step 1: Create batch
    batch = create_batch(pm_root, project_name, user_input)

    # Step 2: Generate openspec docs
    batch = run_spec_generation(batch, llm)
    if batch.status == "failed":
        return batch

    # Step 3: Parse tasks
    tasks = prepare_tasks(batch)
    if not tasks:
        batch.status = "failed"
        batch.error = "No tasks parsed from tasks.md"
        _save_progress(batch)
        return batch

    # Step 4: Run tasks serially
    for task in tasks:
        if task.status in ("completed", "skipped"):
            continue
        run_task(batch, task, llm)

    # Final status
    all_done = all(t.status in ("completed", "skipped") for t in batch.tasks)
    batch.status = "completed" if all_done else "failed"
    _save_progress(batch)

    completed = sum(1 for t in batch.tasks if t.status == "completed")
    failed = sum(1 for t in batch.tasks if t.status == "failed")
    print(f"[PM] Batch finished: {completed} completed, {failed} failed, {len(tasks)} total")
    return batch


def resume_batch(
    batch_dir: str | Path,
    llm: LLM | None = None,
) -> BatchState:
    """Resume a batch from its last incomplete task."""
    if llm is None:
        llm = create_llm()

    batch_dir = Path(batch_dir)
    progress = _read_json(batch_dir / "progress.json")

    batch = BatchState(
        batch_id=progress["batch_id"],
        project_name=progress["project_name"],
        batch_dir=batch_dir,
        status="in_progress",
    )

    # Reload tasks from task.json files
    tasks_root = batch_dir / "tasks"
    if not tasks_root.exists():
        batch.status = "failed"
        batch.error = "No tasks directory found"
        return batch

    task_dirs = sorted(tasks_root.iterdir())
    for td in task_dirs:
        if not td.is_dir():
            continue
        tj = td / "task.json"
        if not tj.exists():
            continue
        data = _read_json(tj)
        batch.tasks.append(TaskState(
            id=data["id"],
            title=data["title"],
            description=data.get("description", ""),
            status=data["status"],
            dependencies=data.get("dependencies", []),
            assigned_module=data.get("assigned_module"),
            task_dir=td,
        ))

    print(f"[PM] Resuming batch {batch.batch_id} — {len(batch.tasks)} tasks")

    # Run remaining tasks
    for task in batch.tasks:
        if task.status in ("completed", "skipped"):
            continue
        # Reset failed tasks to pending for retry
        if task.status == "failed":
            task.status = "pending"
        run_task(batch, task, llm)

    all_done = all(t.status in ("completed", "skipped") for t in batch.tasks)
    batch.status = "completed" if all_done else "failed"
    _save_progress(batch)
    return batch
