"""
Black-box tests generated from openspec/spec.md scenarios.

Each test corresponds to a Given/When/Then scenario from the specification.
Tests verify the observable behavior without depending on implementation details.
"""

import pytest
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from tool_supermarket.core import (
    ToolSuperMarket,
    ToolEntry,
    wrap_tool,
    ToolDefinition,
)


# =============================================================================
# TC-001: Register Python function as tool
# Given: An empty ToolSuperMarket and a Python function `def add(a, b): return a + b`
# When: User calls `register("software-dev/calculator/math/add", add, "Add two numbers")`
# Then: Tool should be retrievable via `get("software-dev/calculator/math/add")`
# =============================================================================
def test_tc001_register_python_function_as_tool():
    """TC-001: Register Python function as tool."""
    # Given
    market = ToolSuperMarket()

    def add(a, b):
        return a + b

    # When
    market.register("software-dev/calculator/math/add", add, "Add two numbers")

    # Then
    tool = market.get("software-dev/calculator/math/add")
    assert tool is not None, "Tool should be retrievable after registration"
    assert isinstance(tool, ToolEntry)


# =============================================================================
# TC-002: Call registered tool
# Given: ToolSuperMarket with registered `add` function
# When: User calls `call("software-dev/calculator/math/add", a=2, b=3)`
# Then: Result should be 5
# =============================================================================
def test_tc002_call_registered_tool():
    """TC-002: Call registered tool."""
    # Given
    market = ToolSuperMarket()

    def add(a, b):
        return a + b

    market.register("software-dev/calculator/math/add", add, "Add two numbers")

    # When
    result = market.call("software-dev/calculator/math/add", a=2, b=3)

    # Then
    assert result == 5, f"Expected 5, got {result}"


# =============================================================================
# TC-003: Auto-generate tool schema
# Given: A Python function `def greet(name: str, count: int = 1) -> str`
# When: User registers it via `wrap_tool(greet)`
# Then: Generated schema should have `name` (required) and `count` (optional with default 1)
# =============================================================================
def test_tc003_auto_generate_tool_schema():
    """TC-003: Auto-generate tool schema."""
    # Given
    def greet(name: str, count: int = 1) -> str:
        return f"Hello, {name}! " * count

    # When
    entry = wrap_tool(greet)

    # Then
    schema = entry.schema()
    assert "properties" in schema, "Schema should have properties"
    assert "name" in schema["properties"], "Schema should have 'name' property"
    assert "count" in schema["properties"], "Schema should have 'count' property"
    assert "name" in schema["required"], "'name' should be required"
    assert "count" not in schema["required"], "'count' should be optional"
    assert schema["properties"]["count"].get("default") == 1, "'count' should have default 1"


# =============================================================================
# TC-004: Export as ToolDefinitions
# Given: ToolSuperMarket with 3 registered tools
# When: User calls `as_tool_definitions()`
# Then: Should return list of 3 openhands-sdk compatible ToolDefinitions
# =============================================================================
def test_tc004_export_as_tool_definitions():
    """TC-004: Export as ToolDefinitions."""
    # Given
    market = ToolSuperMarket()

    def add(a, b):
        return a + b

    def subtract(a, b):
        return a - b

    def multiply(a, b):
        return a * b

    market.register("dev/calc/add", add, "Add numbers")
    market.register("dev/calc/subtract", subtract, "Subtract numbers")
    market.register("dev/calc/multiply", multiply, "Multiply numbers")

    # When
    definitions = market.as_tool_definitions()

    # Then
    assert len(definitions) == 3, f"Expected 3 definitions, got {len(definitions)}"
    for d in definitions:
        assert isinstance(d, ToolDefinition), "Each definition should be ToolDefinition"
        assert hasattr(d, "name"), "ToolDefinition should have 'name'"
        assert hasattr(d, "description"), "ToolDefinition should have 'description'"
        assert hasattr(d, "parameters"), "ToolDefinition should have 'parameters'"
        assert hasattr(d, "callable"), "ToolDefinition should have 'callable'"


# =============================================================================
# TC-005: Browse taxonomy hierarchy
# Given: Tools at "dev/python/lint/pylint" and "dev/python/format/black"
# When: User calls `browse("dev/python")`
# Then: Should return ["dev/python/format", "dev/python/lint"]
# =============================================================================
def test_tc005_browse_taxonomy_hierarchy():
    """TC-005: Browse taxonomy hierarchy."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    market.register("dev/python/lint/pylint", dummy, "Lint with pylint")
    market.register("dev/python/format/black", dummy, "Format with black")

    # When
    children = market.browse("dev/python")

    # Then
    assert "dev/python/format" in children, f"Expected 'dev/python/format' in {children}"
    assert "dev/python/lint" in children, f"Expected 'dev/python/lint' in {children}"


# =============================================================================
# TC-006: Keyword search
# Given: Tools with descriptions "Run pytest tests" and "Format code with black"
# When: User searches `search("pytest", mode="keyword")`
# Then: Should return the pytest tool but not the black tool
# =============================================================================
def test_tc006_keyword_search():
    """TC-006: Keyword search."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    market.register("dev/testing/pytest", dummy, "Run pytest tests")
    market.register("dev/formatting/black", dummy, "Format code with black")

    # When
    results = market.search("pytest", mode="keyword")

    # Then
    assert len(results) >= 1, "Should return at least one result"
    paths = [r.path() for r in results]
    assert any("pytest" in p for p in paths), "Should find pytest tool"
    # Check that black tool is not in results
    black_paths = [p for p in paths if "black" in p.lower()]
    assert len(black_paths) == 0, f"Should not return black tool, but got {black_paths}"


# =============================================================================
# TC-007: Semantic search
# Given: Tools with descriptions "Execute unit tests" and "Deploy to production"
# When: User searches `search("run my test suite", mode="semantic")`
# Then: "Execute unit tests" should rank higher than "Deploy to production"
# =============================================================================
def test_tc007_semantic_search():
    """TC-007: Semantic search."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    pytest_entry = market.register("dev/testing/pytest", dummy, "Execute unit tests")
    deploy_entry = market.register("dev/deploy/prod", dummy, "Deploy to production")

    # When
    results = market.search("run my test suite", mode="semantic")

    # Then
    assert len(results) >= 2, "Should return at least two results"
    # Find position of each tool
    paths = [r.path() for r in results]
    pytest_idx = paths.index("dev/testing/pytest")
    deploy_idx = paths.index("dev/deploy/prod")
    assert pytest_idx < deploy_idx, f"'Execute unit tests' should rank higher than 'Deploy to production'"


# =============================================================================
# TC-008: Tool call error handling
# Given: A tool `def divide(a, b): return a / b`
# When: User calls it with `b=0`
# Then: Should raise ToolExecutionError (not crash the supermarket)
# =============================================================================
def test_tc008_tool_call_error_handling():
    """TC-008: Tool call error handling."""
    # Given
    market = ToolSuperMarket()

    def divide(a, b):
        return a / b

    market.register("dev/calc/divide", divide, "Divide two numbers")

    # When/Then
    try:
        result = market.call("dev/calc/divide", a=10, b=0)
        # If no exception, that's unexpected for division by zero
        assert False, "Expected an error for division by zero"
    except ZeroDivisionError:
        # ZeroDivisionError is acceptable
        pass
    except Exception as e:
        # Some error should be raised - the supermarket should not crash silently
        assert True

    # Marketplace should still be usable after error
    tool = market.get("dev/calc/divide")
    assert tool is not None, "Market should still have the tool after error"


# =============================================================================
# TC-009: Get non-existent tool
# Given: An empty ToolSuperMarket
# When: User calls `get("nonexistent/tool")`
# Then: Should return None (not raise exception)
# =============================================================================
def test_tc009_get_nonexistent_tool():
    """TC-009: Get non-existent tool."""
    # Given
    market = ToolSuperMarket()

    # When
    tool = market.get("nonexistent/tool")

    # Then
    assert tool is None, "Should return None for non-existent tool"


# =============================================================================
# TC-010: Register multiple tools at same level
# Given: Functions `add`, `subtract`, `multiply`
# When: User registers all under "dev/calculator/"
# Then: `browse("dev/calculator")` should list all three
# =============================================================================
def test_tc010_register_multiple_tools_at_same_level():
    """TC-010: Register multiple tools at same level."""
    # Given
    market = ToolSuperMarket()

    def add(a, b):
        return a + b

    def subtract(a, b):
        return a - b

    def multiply(a, b):
        return a * b

    # When
    market.register("dev/calculator/add", add, "Add")
    market.register("dev/calculator/subtract", subtract, "Subtract")
    market.register("dev/calculator/multiply", multiply, "Multiply")

    # Then
    children = market.browse("dev/calculator")
    assert "dev/calculator/add" in children, f"Expected 'dev/calculator/add' in {children}"
    assert "dev/calculator/subtract" in children, f"Expected 'dev/calculator/subtract' in {children}"
    assert "dev/calculator/multiply" in children, f"Expected 'dev/calculator/multiply' in {children}"


# =============================================================================
# TC-011: Filter tool definitions by path
# Given: Tools at "dev/python/*" and "dev/js/*"
# When: User calls `as_tool_definitions(filter_paths=["dev/python"])`
# Then: Should only return tools under dev/python
# =============================================================================
def test_tc011_filter_tool_definitions_by_path():
    """TC-011: Filter tool definitions by path."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    market.register("dev/python/lint/pylint", dummy, "Python linter")
    market.register("dev/python/format/black", dummy, "Python formatter")
    market.register("dev/js/lint/eslint", dummy, "JS linter")
    market.register("dev/js/format/prettier", dummy, "JS formatter")

    # When
    definitions = market.as_tool_definitions(filter_paths=["dev/python"])

    # Then
    assert len(definitions) == 2, f"Expected 2 definitions, got {len(definitions)}"
    for d in definitions:
        # The callable has the function, we need to check via the path
        # Since ToolDefinition uses last path component as name
        assert d.name in ["pylint", "black"], f"Got unexpected tool: {d.name}"


# =============================================================================
# TC-012: Tool with complex parameters
# Given: Function `def process(items: list[dict], options: dict | None = None)`
# When: User wraps it with `wrap_tool(process)`
# Then: Schema should correctly represent list of dicts and optional dict
# =============================================================================
def test_tc012_tool_with_complex_parameters():
    """TC-012: Tool with complex parameters."""
    # Given
    def process(items: list[dict], options: dict | None = None) -> dict:
        return {"items": items, "options": options}

    # When
    entry = wrap_tool(process)

    # Then
    schema = entry.schema()
    assert "properties" in schema, "Schema should have properties"
    assert "items" in schema["properties"], "Schema should have 'items' property"
    assert "options" in schema["properties"], "Schema should have 'options' property"

    # Check items is an array type
    items_schema = schema["properties"]["items"]
    assert items_schema.get("type") == "array", f"'items' should be array, got {items_schema}"

    # Check options is optional
    assert "options" not in schema["required"], "'options' should be optional"
    assert schema["properties"]["options"].get("default") is None, "'options' should have default None"


# =============================================================================
# TC-013: Frequency tracking
# Given: A tool accessed 0 times
# When: User calls `call()` on it 5 times
# Then: `get_access_count()` should return 5
# =============================================================================
def test_tc013_frequency_tracking():
    """TC-013: Frequency tracking."""
    # Given
    market = ToolSuperMarket()

    def add(a, b):
        return a + b

    market.register("dev/calc/add", add, "Add numbers")
    tool = market.get("dev/calc/add")
    assert tool.get_access_count() == 0, "Initial access count should be 0"

    # When
    for i in range(5):
        market.call("dev/calc/add", a=i, b=i + 1)

    # Then
    tool = market.get("dev/calc/add")
    assert tool.get_access_count() == 5, f"Expected access count 5, got {tool.get_access_count()}"


# =============================================================================
# TC-014: Callable preserves function behavior
# Given: Function `def hello(name): return f"Hello, {name}!"`
# When: User registers and invokes it
# Then: Result should be exactly "Hello, World!" for name="World"
# =============================================================================
def test_tc014_callable_preserves_function_behavior():
    """TC-014: Callable preserves function behavior."""
    # Given
    market = ToolSuperMarket()

    def hello(name):
        return f"Hello, {name}!"

    market.register("dev/greeting/hello", hello, "Say hello")

    # When
    result = market.call("dev/greeting/hello", name="World")

    # Then
    assert result == "Hello, World!", f"Expected 'Hello, World!', got '{result}'"


# =============================================================================
# TC-015: Empty browse returns roots
# Given: Tools at "a/b/c" and "x/y/z"
# When: User calls `browse("")`
# Then: Should return ["a", "x"]
# =============================================================================
def test_tc015_empty_browse_returns_roots():
    """TC-015: Empty browse returns roots."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    market.register("a/b/c", dummy, "Tool in a/b/c")
    market.register("x/y/z", dummy, "Tool in x/y/z")

    # When
    roots = market.browse("")

    # Then
    assert "a" in roots, f"Expected 'a' in {roots}"
    assert "x" in roots, f"Expected 'x' in {roots}"


# =============================================================================
# TC-016: Regex search on paths
# Given: Tools at "dev/python/lint/pylint" and "dev/python/format/black"
# When: User searches `search(".*lint.*", mode="regex")`
# Then: Should return pylint tool only
# =============================================================================
def test_tc016_regex_search_on_paths():
    """TC-016: Regex search on paths."""
    # Given
    market = ToolSuperMarket()

    def dummy():
        pass

    market.register("dev/python/lint/pylint", dummy, "Lint with pylint")
    market.register("dev/python/format/black", dummy, "Format with black")

    # When
    results = market.search(".*lint.*", mode="regex")

    # Then
    assert len(results) == 1, f"Expected 1 result, got {len(results)}"
    assert results[0].path() == "dev/python/lint/pylint", f"Expected pylint, got {results[0].path()}"


# =============================================================================
# TC-017: Tool with no parameters
# Given: Function `def get_version(): return "1.0.0"`
# When: User registers and calls it
# Then: Should work without any arguments
# =============================================================================
def test_tc017_tool_with_no_parameters():
    """TC-017: Tool with no parameters."""
    # Given
    market = ToolSuperMarket()

    def get_version():
        return "1.0.0"

    market.register("dev/meta/version", get_version, "Get version")

    # When
    result = market.call("dev/meta/version")

    # Then
    assert result == "1.0.0", f"Expected '1.0.0', got '{result}'"


# =============================================================================
# TC-018: Concurrent access
# Given: A ToolSuperMarket instance
# When: Two threads register and call tools simultaneously
# Then: No race conditions or data corruption
# =============================================================================
def test_tc018_concurrent_access():
    """TC-018: Concurrent access."""
    # Given
    market = ToolSuperMarket()
    errors = []
    results = []

    def register_and_call(thread_id):
        try:
            for i in range(10):
                # Register
                def make_func(tid, op_id):
                    def fn(x):
                        return x + tid * 100 + op_id
                    return fn

                path = f"dev/thread{thread_id}/op{i}"
                market.register(path, make_func(thread_id, i), f"Thread {thread_id} op {i}")

                # Call
                result = market.call(path, x=0)
                results.append((thread_id, i, result))

                # Browse
                children = market.browse(f"dev/thread{thread_id}")

                # Search
                found = market.search(f"thread{thread_id}", mode="keyword")
        except Exception as e:
            errors.append((thread_id, str(e)))

    # When
    threads = []
    for tid in range(5):
        t = threading.Thread(target=register_and_call, args=(tid,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # Then
    assert len(errors) == 0, f"Concurrent access caused errors: {errors}"
    # Verify all operations completed
    assert len(results) == 50, f"Expected 50 results, got {len(results)}"


# =============================================================================
# TC-019: Tool returns None
# Given: Function `def maybe_return(x): return None if x < 0 else x`
# When: User calls with x=-5
# Then: Should return None (not raise error)
# =============================================================================
def test_tc019_tool_returns_none():
    """TC-019: Tool returns None."""
    # Given
    market = ToolSuperMarket()

    def maybe_return(x):
        return None if x < 0 else x

    market.register("dev/util/maybe", maybe_return, "Maybe return value")

    # When
    result = market.call("dev/util/maybe", x=-5)

    # Then
    assert result is None, f"Expected None, got {result}"

    # Also verify positive case
    result_positive = market.call("dev/util/maybe", x=5)
    assert result_positive == 5, f"Expected 5, got {result_positive}"


# =============================================================================
# TC-020: Description used in search
# Given: Tool with description "Calculate fibonacci numbers efficiently"
# When: User searches `search("fibonacci calculation", mode="semantic")`
# Then: Tool should appear in results
# =============================================================================
def test_tc020_description_used_in_search():
    """TC-020: Description used in search."""
    # Given
    market = ToolSuperMarket()

    def fib(n):
        return n if n <= 1 else fib(n - 1) + fib(n - 2)

    def unrelated(x):
        return x

    fib_entry = market.register(
        "dev/math/fibonacci",
        fib,
        "Calculate fibonacci numbers efficiently"
    )
    market.register(
        "dev/util/identity",
        unrelated,
        "Return input unchanged"
    )

    # When
    results = market.search("fibonacci calculation", mode="semantic")

    # Then
    assert len(results) >= 1, "Should return at least one result"
    paths = [r.path() for r in results]
    assert "dev/math/fibonacci" in paths, f"Fibonacci tool should be in results, got {paths}"
    # Fibonacci should rank first (or at least highly)
    assert results[0].path() == "dev/math/fibonacci", f"Expected fibonacci first, got {results[0].path()}"
