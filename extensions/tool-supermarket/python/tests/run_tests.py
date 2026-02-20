#!/usr/bin/env python3
"""
Quick test runner script for ToolSuperMarket tests.
Run from the project root directory.
"""

import sys
import subprocess
from pathlib import Path


def run_tests(args):
    """Run pytest with the given arguments."""
    cmd = ["python", "-m", "pytest"] + args
    
    print(f"Running: {' '.join(cmd)}")
    print("-" * 80)
    
    result = subprocess.run(cmd, cwd=Path(__file__).parent)
    return result.returncode


def main():
    """Main entry point."""
    # Default arguments
    args = sys.argv[1:] if len(sys.argv) > 1 else ["-v"]
    
    # Run tests
    exit_code = run_tests(args)
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
