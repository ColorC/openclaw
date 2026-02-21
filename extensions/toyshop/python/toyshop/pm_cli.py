"""PM CLI — Step-by-step project management pipeline.

Usage:
  # Full auto pipeline (existing)
  python3 -m toyshop.pm_cli run --name <project> --input <file_or_text> [--pm-root <dir>]

  # Step-by-step (for supervised development)
  python3 -m toyshop.pm_cli create --name <project> --input <file_or_text> [--pm-root <dir>]
  python3 -m toyshop.pm_cli spec   --batch <batch_dir>
  python3 -m toyshop.pm_cli tasks  --batch <batch_dir>
  python3 -m toyshop.pm_cli tdd    --batch <batch_dir>

  # Utilities
  python3 -m toyshop.pm_cli status --batch <batch_dir>
  python3 -m toyshop.pm_cli resume --batch <batch_dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cmd_run(args: argparse.Namespace) -> None:
    """Full auto: create → spec → tasks → tdd."""
    from toyshop.pm import run_batch
    from toyshop.llm import create_llm

    user_input = _read_input(args.input)
    llm = create_llm()
    batch = run_batch(Path(args.pm_root), args.name, user_input, llm)
    _print_result(batch)


def cmd_create(args: argparse.Namespace) -> None:
    """Step 1: Create batch folder with requirements.md."""
    from toyshop.pm import create_batch

    user_input = _read_input(args.input)
    batch = create_batch(Path(args.pm_root), args.name, user_input)
    print(f"Batch dir: {batch.batch_dir}")
    print("Next: python3 -m toyshop.pm_cli spec --batch <batch_dir>")


def cmd_spec(args: argparse.Namespace) -> None:
    """Step 2: Generate openspec docs (proposal, design, tasks, spec)."""
    from toyshop.pm import load_batch, run_spec_generation
    from toyshop.llm import create_llm

    batch = load_batch(args.batch)
    llm = create_llm()
    batch = run_spec_generation(batch, llm)
    _print_result(batch)
    if batch.status != "failed":
        print("\nGenerated docs:")
        for f in sorted((batch.batch_dir / "openspec").iterdir()):
            print(f"  {f.name}")
        print("\nReview openspec/ docs, then:")
        print("  python3 -m toyshop.pm_cli tasks --batch", args.batch)


def cmd_tasks(args: argparse.Namespace) -> None:
    """Step 3: Parse tasks.md → create task folders (display only)."""
    from toyshop.pm import load_batch, prepare_tasks

    batch = load_batch(args.batch)
    tasks = prepare_tasks(batch)
    print(f"Parsed {len(tasks)} tasks:")
    for t in tasks:
        print(f"  [{t.id}] {t.title}")
    print("\nNext: python3 -m toyshop.pm_cli tdd --batch", args.batch)


def cmd_tdd(args: argparse.Namespace) -> None:
    """Step 4: Run TDD pipeline for the batch."""
    from toyshop.pm import load_batch, run_batch_tdd
    from toyshop.llm import create_llm

    batch = load_batch(args.batch)
    llm = create_llm()
    result = run_batch_tdd(batch, llm)
    print(f"\nTDD result: {'PASS' if result.success else 'FAIL'}")
    print(f"  Whitebox: {'pass' if result.whitebox_passed else 'fail'}")
    print(f"  Blackbox: {'pass' if result.blackbox_passed else 'fail'}")
    print(f"  Retries: {result.retry_count}")
    if result.files_created:
        print(f"  Files: {len(result.files_created)}")
    _print_result(batch)


def cmd_status(args: argparse.Namespace) -> None:
    """Show batch status."""
    batch_dir = Path(args.batch)
    progress_path = batch_dir / "progress.json"
    if not progress_path.exists():
        print(f"No progress.json in {batch_dir}")
        sys.exit(1)

    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    print(f"Batch: {progress['batch_id']}")
    print(f"Project: {progress['project_name']}")
    print(f"Status: {progress['status']}")
    print(f"Tasks: {progress['completed_tasks']}/{progress['total_tasks']} completed, "
          f"{progress['failed_tasks']} failed")
    if progress.get("current_task"):
        print(f"Current: {progress['current_task']}")

    tasks_root = batch_dir / "tasks"
    if tasks_root.exists():
        for td in sorted(tasks_root.iterdir()):
            tj = td / "task.json"
            if tj.exists():
                t = json.loads(tj.read_text(encoding="utf-8"))
                print(f"  [{t['status']:>11}] {t['id']} {t['title']}")

    # Show result if available
    result_path = batch_dir / "result.json"
    if result_path.exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if "error" in result:
            print(f"\nLast error: {result['error']}")
        elif "success" in result:
            print(f"\nTDD: {'PASS' if result['success'] else 'FAIL'}")


def cmd_resume(args: argparse.Namespace) -> None:
    """Resume an interrupted batch (re-run TDD)."""
    from toyshop.pm import resume_batch
    from toyshop.llm import create_llm

    llm = create_llm()
    batch = resume_batch(args.batch, llm)
    _print_result(batch)


# --- Helpers ---

def _read_input(input_arg: str) -> str:
    input_path = Path(input_arg)
    if input_path.is_file():
        return input_path.read_text(encoding="utf-8")
    return input_arg


def _print_result(batch) -> None:
    print(f"\nBatch dir: {batch.batch_dir}")
    print(f"Status: {batch.status}")
    if batch.error:
        print(f"Error: {batch.error}")
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(prog="toyshop-pm", description="ToyShop PM System")
    sub = parser.add_subparsers(dest="command", required=True)

    # run (full auto)
    p_run = sub.add_parser("run", help="Full auto: create → spec → tasks → tdd")
    p_run.add_argument("--name", required=True)
    p_run.add_argument("--input", required=True, help="Requirements text or path to .md file")
    p_run.add_argument("--pm-root", default=str(Path.home() / ".toyshop" / "projects"))

    # create (step 1)
    p_create = sub.add_parser("create", help="Step 1: Create batch with requirements")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--input", required=True)
    p_create.add_argument("--pm-root", default=str(Path.home() / ".toyshop" / "projects"))

    # spec (step 2)
    p_spec = sub.add_parser("spec", help="Step 2: Generate openspec docs")
    p_spec.add_argument("--batch", required=True)

    # tasks (step 3)
    p_tasks = sub.add_parser("tasks", help="Step 3: Parse tasks → create folders")
    p_tasks.add_argument("--batch", required=True)

    # tdd (step 4)
    p_tdd = sub.add_parser("tdd", help="Step 4: Run TDD pipeline")
    p_tdd.add_argument("--batch", required=True)

    # status
    p_status = sub.add_parser("status", help="Show batch status")
    p_status.add_argument("--batch", required=True)

    # resume
    p_resume = sub.add_parser("resume", help="Resume interrupted batch")
    p_resume.add_argument("--batch", required=True)

    args = parser.parse_args()
    cmd = {
        "run": cmd_run, "create": cmd_create, "spec": cmd_spec,
        "tasks": cmd_tasks, "tdd": cmd_tdd, "status": cmd_status,
        "resume": cmd_resume,
    }
    cmd[args.command](args)


if __name__ == "__main__":
    main()
