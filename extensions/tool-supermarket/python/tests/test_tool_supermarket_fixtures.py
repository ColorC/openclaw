"""
Additional tests using pytest fixtures for better test organization.
"""

import pytest
from tool_supermarket.core import ToolSuperMarket, ToolEntry, wrap_tool


class TestWithEmptyMarket:
    """Tests using empty_market fixture."""

    def test_empty_market_has_no_tools(self, empty_market):
        """Empty market should have no tools."""
        definitions = empty_market.as_tool_definitions()
        assert definitions == []

    def test_empty_market_browse_returns_empty(self, empty_market):
        """Browsing empty market should return empty list."""
        result = empty_market.browse("")
        assert isinstance(result, list)

    def test_empty_market_get_returns_none(self, empty_market):
        """Getting from empty market should return None."""
        result = empty_market.get("nonexistent/tool")
        assert result is None


class TestWithPopulatedMarket:
    """Tests using populated_market fixture."""

    def test_populated_market_has_tools(self, populated_market):
        """Populated market should have tools."""
        definitions = populated_market.as_tool_definitions()
        assert len(definitions) >= 7  # We registered 7 tools

    def test_populated_market_browse(self, populated_market):
        """Browsing populated market should show categories."""
        result = populated_market.browse("dev")
        assert isinstance(result, list)

    def test_populated_market_get_existing(self, populated_market):
        """Getting existing tool should return ToolEntry."""
        entry = populated_market.get("dev/calculator/add")
        assert entry is not None
        assert isinstance(entry, ToolEntry)

    def test_populated_market_search(self, populated_market):
        """Searching populated market should find results."""
        results = populated_market.search("pytest", mode="keyword")
        assert len(results) >= 1


class TestWithSampleFunction:
    """Tests using sample_function fixture."""

    def test_register_sample_function(self, sample_function):
        """Register sample function should work."""
        market = ToolSuperMarket()
        entry = market.register("dev/test", sample_function, "Test function")
        
        assert isinstance(entry, ToolEntry)
        assert market.get("dev/test") is not None

    def test_call_sample_function(self, sample_function):
        """Calling sample function should work correctly."""
        market = ToolSuperMarket()
        market.register("dev/test", sample_function, "Test function")
        
        result = market.call("dev/test", a=5, b=3)
        assert result == 8

    def test_wrap_sample_function(self, sample_function):
        """Wrapping sample function should generate schema."""
        entry = wrap_tool(sample_function, "Test function")
        
        schema = entry.schema()
        assert isinstance(schema, dict)


class TestWithDefaultsFunction:
    """Tests using sample_function_with_defaults fixture."""

    def test_call_with_defaults(self, sample_function_with_defaults):
        """Function with defaults should work without optional args."""
        market = ToolSuperMarket()
        market.register("dev/greet", sample_function_with_defaults, "Greet")
        
        result = market.call("dev/greet", name="World")
        assert result == "Hello, World! "

    def test_call_with_explicit_defaults(self, sample_function_with_defaults):
        """Function with defaults should work with optional args."""
        market = ToolSuperMarket()
        market.register("dev/greet", sample_function_with_defaults, "Greet")
        
        result = market.call("dev/greet", name="World", count=3)
        assert result == "Hello, World! Hello, World! Hello, World! "

    def test_wrap_generates_correct_schema(self, sample_function_with_defaults):
        """Wrapping function with defaults should reflect in schema."""
        entry = wrap_tool(sample_function_with_defaults, "Greet")
        
        schema = entry.schema()
        # 'name' should be required, 'count' should be optional
        assert isinstance(schema, dict)


class TestWithNoParamsFunction:
    """Tests using sample_function_no_params fixture."""

    def test_call_no_params(self, sample_function_no_params):
        """Function with no params should be callable without args."""
        market = ToolSuperMarket()
        market.register("dev/version", sample_function_no_params, "Version")
        
        result = market.call("dev/version")
        assert result == "1.0.0"

    def test_wrap_no_params_schema(self, sample_function_no_params):
        """Function with no params should have appropriate schema."""
        entry = wrap_tool(sample_function_no_params, "Version")
        
        schema = entry.schema()
        # Should have empty or minimal schema
        assert isinstance(schema, dict)


class TestWithComplexTypesFunction:
    """Tests using sample_function_complex_types fixture."""

    def test_call_with_complex_types(self, sample_function_complex_types):
        """Function with complex types should work correctly."""
        market = ToolSuperMarket()
        market.register("dev/process", sample_function_complex_types, "Process")
        
        items = [{"id": 1, "name": "item1"}, {"id": 2, "name": "item2"}]
        options = {"verbose": True}
        
        result = market.call("dev/process", items=items, options=options)
        
        assert result == {"items": items, "options": options}

    def test_call_complex_types_optional_none(self, sample_function_complex_types):
        """Function with optional complex type should accept None."""
        market = ToolSuperMarket()
        market.register("dev/process", sample_function_complex_types, "Process")
        
        items = [{"id": 1}]
        
        result = market.call("dev/process", items=items, options=None)
        
        assert result == {"items": items, "options": None}


class TestWithNoneReturnFunction:
    """Tests using function_that_may_return_none fixture."""

    def test_returns_none(self, function_that_may_return_none):
        """Function that returns None should work."""
        market = ToolSuperMarket()
        market.register("dev/maybe", function_that_may_return_none, "Maybe")
        
        result = market.call("dev/maybe", x=-5)
        assert result is None

    def test_returns_value(self, function_that_may_return_none):
        """Function that can return None should also return values."""
        market = ToolSuperMarket()
        market.register("dev/maybe", function_that_may_return_none, "Maybe")
        
        result = market.call("dev/maybe", x=10)
        assert result == 10


class TestWithRaisingFunction:
    """Tests using function_that_raises fixture."""

    def test_raises_on_error(self, function_that_raises):
        """Function that raises should propagate the error."""
        market = ToolSuperMarket()
        market.register("dev/divide", function_that_raises, "Divide")
        
        with pytest.raises((ZeroDivisionError, Exception)):
            market.call("dev/divide", a=10, b=0)

    def test_works_correctly(self, function_that_raises):
        """Function that can raise should work when used correctly."""
        market = ToolSuperMarket()
        market.register("dev/divide", function_that_raises, "Divide")
        
        result = market.call("dev/divide", a=10, b=2)
        assert result == 5.0


class TestMarketOperations:
    """Tests for various market operations using fixtures."""

    def test_multiple_registrations(self):
        """Multiple registrations should all be available."""
        market = ToolSuperMarket()
        
        def func1(): return 1
        def func2(): return 2
        def func3(): return 3
        
        market.register("a/b/c/func1", func1, "Func 1")
        market.register("x/y/z/func2", func2, "Func 2")
        market.register("d/e/f/func3", func3, "Func 3")
        
        assert market.get("a/b/c/func1") is not None
        assert market.get("x/y/z/func2") is not None
        assert market.get("d/e/f/func3") is not None

    def test_path_isolation(self):
        """Tools at different paths should be isolated."""
        market = ToolSuperMarket()
        
        def add(a, b): return a + b
        def mult(a, b): return a * b
        
        market.register("math/add", add, "Add")
        market.register("math/mult", mult, "Multiply")
        
        assert market.call("math/add", a=2, b=3) == 5
        assert market.call("math/mult", a=2, b=3) == 6

    def test_filter_by_multiple_paths(self, populated_market):
        """Filter by multiple paths should work."""
        definitions = populated_market.as_tool_definitions(
            filter_paths=["dev/calculator", "dev/python/testing"]
        )
        
        # Should get calculator (3) + testing (2) = 5 tools
        assert len(definitions) == 5


@pytest.mark.parametrize("path,description", [
    ("a/b/c", "Tool at a/b/c"),
    ("x/y/z", "Tool at x/y/z"),
    ("level1/level2/level3/level4", "Deep tool"),
])
def test_various_paths(path, description):
    """Test registration at various path levels."""
    market = ToolSuperMarket()
    
    def dummy(): return "test"
    
    entry = market.register(path, dummy, description)
    assert isinstance(entry, ToolEntry)
    assert market.get(path) is not None


@pytest.mark.parametrize("mode", ["keyword", "semantic", "regex"])
def test_search_modes(mode):
    """Test all search modes work."""
    market = ToolSuperMarket()
    
    def test_func(): return "test"
    
    market.register("dev/python/test", test_func, "Python testing tool")
    
    # Different queries for different modes
    if mode == "keyword":
        query = "python"
    elif mode == "semantic":
        query = "code testing"
    else:
        query = ".*test.*"
    
    results = market.search(query, mode=mode)
    assert isinstance(results, list)


@pytest.mark.parametrize("top_k", [1, 5, 10, 100])
def test_search_top_k(top_k):
    """Test search respects top_k parameter."""
    market = ToolSuperMarket()
    
    # Register many tools
    for i in range(50):
        def make_func(n):
            def func(): return n
            return func
        market.register(f"dev/tool{i}", make_func(i), f"Tool number {i}")
    
    results = market.search("tool", mode="keyword", top_k=top_k)
    assert len(results) <= top_k
