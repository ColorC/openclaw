"""
Pytest configuration and shared fixtures for tool_supermarket tests.
"""

import pytest
from typing import Callable
from tool_supermarket.core import ToolSuperMarket, ToolEntry


@pytest.fixture
def empty_market():
    """Fixture providing an empty ToolSuperMarket instance."""
    return ToolSuperMarket()


@pytest.fixture
def populated_market():
    """Fixture providing a ToolSuperMarket with sample tools."""
    market = ToolSuperMarket()
    
    # Calculator tools
    def add(a: int, b: int) -> int:
        return a + b
    
    def subtract(a: int, b: int) -> int:
        return a - b
    
    def multiply(a: int, b: int) -> int:
        return a * b
    
    # Try to register tools (may fail if implementation is stub)
    try:
        market.register("dev/calculator/add", add, "Add two numbers")
        market.register("dev/calculator/subtract", subtract, "Subtract two numbers")
        market.register("dev/calculator/multiply", multiply, "Multiply two numbers")
    except NotImplementedError:
        # Implementation is stub, return empty market
        pass
    
    # Testing tools
    def run_pytest(test_path: str) -> str:
        return f"Running pytest on {test_path}"
    
    def run_coverage(source_path: str) -> str:
        return f"Checking coverage for {source_path}"
    
    try:
        market.register("dev/python/testing/pytest", run_pytest, "Run pytest tests")
        market.register("dev/python/testing/coverage", run_coverage, "Check code coverage")
    except NotImplementedError:
        pass
    
    # Formatting tools
    def format_black(file_path: str) -> str:
        return f"Formatting {file_path} with black"
    
    def lint_pylint(file_path: str) -> str:
        return f"Linting {file_path} with pylint"
    
    try:
        market.register("dev/python/format/black", format_black, "Format code with black")
        market.register("dev/python/lint/pylint", lint_pylint, "Lint code with pylint")
    except NotImplementedError:
        pass
    
    return market


@pytest.fixture
def sample_function():
    """Fixture providing a simple sample function."""
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b
    return add


@pytest.fixture
def sample_function_with_defaults():
    """Fixture providing a function with default parameters."""
    def greet(name: str, count: int = 1) -> str:
        """Greet a person multiple times."""
        return f"Hello, {name}! " * count
    return greet


@pytest.fixture
def sample_function_no_params():
    """Fixture providing a function with no parameters."""
    def get_version() -> str:
        """Get the version string."""
        return "1.0.0"
    return get_version


@pytest.fixture
def sample_function_complex_types():
    """Fixture providing a function with complex type hints."""
    def process(items: list[dict], options: dict | None = None) -> dict:
        """Process items with optional configuration."""
        return {"items": items, "options": options}
    return process


@pytest.fixture
def function_that_may_return_none():
    """Fixture providing a function that can return None."""
    def maybe_return(x: int) -> int | None:
        """Return None if negative, else return the value."""
        return None if x < 0 else x
    return maybe_return


@pytest.fixture
def function_that_raises():
    """Fixture providing a function that raises an error."""
    def divide(a: float, b: float) -> float:
        """Divide two numbers."""
        return a / b
    return divide


# Markers for different test categories
def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "concurrent: marks tests that test concurrent behavior"
    )
    config.addinivalue_line(
        "markers", "integration: marks integration tests"
    )
    config.addinivalue_line(
        "markers", "unit: marks unit tests"
    )
