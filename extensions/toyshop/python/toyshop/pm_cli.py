"""PM CLI — Command-line interface for the PM system.

Usage:
  python3 -m toyshop.pm_cli run --name <project> --input <file_or_text> [--pm-root <dir>]
  python3 -m toyshop.pm_cli status --batch <batch_dir>
  python3 -m toyshop.pm_cli resume --batch <batch_dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cmd_run(args: argparse.Namespace) -> None:
    from toyshop.pm import run_batch
    from toyshop.llm import create_llm

    # Read input from file or use as string
    input_path = Path(args.input)
    if input_path.is_file():
        user_input = input_path.read_text(encoding="utf-8")
    else:
        user_input = args.input

    pm_root = Path(args.pm_root)
    llm = create_llm()

    batch = run_batch(pm_root, args.name, user_input, llm)
    print(f"\nBatch dir: {batch.batch_dir}")
    print(f"Status: {batch.status}")
    if batch.error:
        print(f"Error: {batch.error}")
        sys.exit(1)


def cmd_status(args: argparse.Namespace) -> None:
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

    # Show per-task status
    tasks_root = batch_dir / "tasks"
    if tasks_root.exists():
        for td in sorted(tasks_root.iterdir()):
            tj = td / "task.json"
            if tj.exists():
                t = json.loads(tj.read_text(encoding="utf-8"))
                print(f"  [{t['status']:>11}] {t['id']} {t['title']}")


def cmd_resume(args: argparse.Namespace) -> None:
    from toyshop.pm import resume_batch
    from toyshop.llm import create_llm

    llm = create_llm()
    batch = resume_batch(args.batch, llm)
    print(f"\nBatch dir: {batch.batch_dir}")
    print(f"Status: {batch.status}")
    if batch.error:
        print(f"Error: {batch.error}")
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(prog="toyshop-pm", description="ToyShop PM System")
    sub = parser.add_subparsers(dest="command", required=True)

    # run
    p_run = sub.add_parser("run", help="Run a new batch")
    p_run.add_argument("--name", required=True, help="Project name")
    p_run.add_argument("--input", required=True, help="Requirements text or path to .md file")
    p_run.add_argument("--pm-root", default=str(Path.home() / ".toyshop" / "projects"),
                        help="PM root directory")

    # status
    p_status = sub.add_parser("status", help="Show batch status")
    p_status.add_argument("--batch", required=True, help="Batch directory path")

    # resume
    p_resume = sub.add_parser("resume", help="Resume an interrupted batch")
    p_resume.add_argument("--batch", required=True, help="Batch directory path")

    args = parser.parse_args()

    if args.command == "run":
        cmd_run(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "resume":
        cmd_resume(args)


if __name__ == "__main__":
    main()
