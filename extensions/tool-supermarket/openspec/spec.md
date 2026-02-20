# Specification

## TC-001: Register Python function as tool

**Given:** An empty ToolSuperMarket and a Python function `def add(a, b): return a + b`
**When:** User calls `register("software-dev/calculator/math/add", add, "Add two numbers")`
**Then:** Tool should be retrievable via `get("software-dev/calculator/math/add")`

## TC-002: Call registered tool

**Given:** ToolSuperMarket with registered `add` function
**When:** User calls `call("software-dev/calculator/math/add", a=2, b=3)`
**Then:** Result should be 5

## TC-003: Auto-generate tool schema

**Given:** A Python function `def greet(name: str, count: int = 1) -> str`
**When:** User registers it via `wrap_tool(greet)`
**Then:** Generated schema should have `name` (required) and `count` (optional with default 1)

## TC-004: Export as ToolDefinitions

**Given:** ToolSuperMarket with 3 registered tools
**When:** User calls `as_tool_definitions()`
**Then:** Should return list of 3 openhands-sdk compatible ToolDefinitions

## TC-005: Browse taxonomy hierarchy

**Given:** Tools at "dev/python/lint/pylint" and "dev/python/format/black"
**When:** User calls `browse("dev/python")`
**Then:** Should return ["dev/python/format", "dev/python/lint"]

## TC-006: Keyword search

**Given:** Tools with descriptions "Run pytest tests" and "Format code with black"
**When:** User searches `search("pytest", mode="keyword")`
**Then:** Should return the pytest tool but not the black tool

## TC-007: Semantic search

**Given:** Tools with descriptions "Execute unit tests" and "Deploy to production"
**When:** User searches `search("run my test suite", mode="semantic")`
**Then:** "Execute unit tests" should rank higher than "Deploy to production"

## TC-008: Tool call error handling

**Given:** A tool `def divide(a, b): return a / b`
**When:** User calls it with `b=0`
**Then:** Should raise ToolExecutionError (not crash the supermarket)

## TC-009: Get non-existent tool

**Given:** An empty ToolSuperMarket
**When:** User calls `get("nonexistent/tool")`
**Then:** Should return None (not raise exception)

## TC-010: Register multiple tools at same level

**Given:** Functions `add`, `subtract`, `multiply`
**When:** User registers all under "dev/calculator/"
**Then:** `browse("dev/calculator")` should list all three

## TC-011: Filter tool definitions by path

**Given:** Tools at "dev/python/_" and "dev/js/_"
**When:** User calls `as_tool_definitions(filter_paths=["dev/python"])`
**Then:** Should only return tools under dev/python

## TC-012: Tool with complex parameters

**Given:** Function `def process(items: list[dict], options: dict | None = None)`
**When:** User wraps it with `wrap_tool(process)`
**Then:** Schema should correctly represent list of dicts and optional dict

## TC-013: Frequency tracking

**Given:** A tool accessed 0 times
**When:** User calls `call()` on it 5 times
**Then:** `get_access_count()` should return 5

## TC-014: Callable preserves function behavior

**Given:** Function `def hello(name): return f"Hello, {name}!"`
**When:** User registers and invokes it
**Then:** Result should be exactly "Hello, World!" for name="World"

## TC-015: Empty browse returns roots

**Given:** Tools at "a/b/c" and "x/y/z"
**When:** User calls `browse("")`
**Then:** Should return ["a", "x"]

## TC-016: Regex search on paths

**Given:** Tools at "dev/python/lint/pylint" and "dev/python/format/black"
**When:** User searches `search(".*lint.*", mode="regex")`
**Then:** Should return pylint tool only

## TC-017: Tool with no parameters

**Given:** Function `def get_version(): return "1.0.0"`
**When:** User registers and calls it
**Then:** Should work without any arguments

## TC-018: Concurrent access

**Given:** A ToolSuperMarket instance
**When:** Two threads register and call tools simultaneously
**Then:** No race conditions or data corruption

## TC-019: Tool returns None

**Given:** Function `def maybe_return(x): return None if x < 0 else x`
**When:** User calls with x=-5
**Then:** Should return None (not raise error)

## TC-020: Description used in search

**Given:** Tool with description "Calculate fibonacci numbers efficiently"
**When:** User searches `search("fibonacci calculation", mode="semantic")`
**Then:** Tool should appear in results
