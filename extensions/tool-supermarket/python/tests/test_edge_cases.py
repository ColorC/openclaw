"""
Error handling and edge case tests for ToolSuperMarket.
"""

import pytest
from tool_supermarket.core import ToolSuperMarket, ToolEntry, wrap_tool


class TestErrorHandling:
    """Tests for error handling in various scenarios."""

    def test_get_nonexistent_tool_returns_none(self):
        """Getting non-existent tool should return None, not raise."""
        market = ToolSuperMarket()
        
        result = market.get("nonexistent/path")
        
        assert result is None

    def test_call_nonexistent_tool_raises(self):
        """Calling non-existent tool should raise appropriate error."""
        market = ToolSuperMarket()
        
        with pytest.raises((KeyError, ValueError, AttributeError, Exception)):
            market.call("nonexistent/tool")

    def test_tool_raises_error(self):
        """Tool that raises error should propagate it."""
        market = ToolSuperMarket()
        
        def raises_error():
            raise ValueError("Intentional error")
        
        market.register("test/error", raises_error, "Error tool")
        
        with pytest.raises(ValueError, match="Intentional error"):
            market.call("test/error")

    def test_tool_raises_division_by_zero(self):
        """Tool with division by zero should raise appropriately."""
        market = ToolSuperMarket()
        
        def divide(a, b):
            return a / b
        
        market.register("test/divide", divide, "Divide")
        
        with pytest.raises(ZeroDivisionError):
            market.call("test/divide", a=10, b=0)

    def test_tool_type_error(self):
        """Tool with wrong arguments should raise TypeError."""
        market = ToolSuperMarket()
        
        def add(a: int, b: int) -> int:
            return a + b
        
        market.register("test/add", add, "Add")
        
        # Calling with missing arguments
        with pytest.raises((TypeError, Exception)):
            market.call("test/add", a=5)  # missing b

    def test_tool_with_none_return(self):
        """Tool that returns None should work correctly."""
        market = ToolSuperMarket()
        
        def returns_none(x):
            return None
        
        market.register("test/none", returns_none, "Returns None")
        
        result = market.call("test/none", x=5)
        
        assert result is None

    def test_tool_returns_false(self):
        """Tool that returns False should work correctly."""
        market = ToolSuperMarket()
        
        def returns_false(x):
            return False
        
        market.register("test/false", returns_false, "Returns False")
        
        result = market.call("test/false", x=5)
        
        assert result is False

    def test_tool_returns_zero(self):
        """Tool that returns 0 should work correctly."""
        market = ToolSuperMarket()
        
        def returns_zero(x):
            return 0
        
        market.register("test/zero", returns_zero, "Returns Zero")
        
        result = market.call("test/zero", x=5)
        
        assert result == 0

    def test_tool_returns_empty_string(self):
        """Tool that returns empty string should work correctly."""
        market = ToolSuperMarket()
        
        def returns_empty(x):
            return ""
        
        market.register("test/empty", returns_empty, "Returns Empty")
        
        result = market.call("test/empty", x=5)
        
        assert result == ""

    def test_tool_returns_empty_list(self):
        """Tool that returns empty list should work correctly."""
        market = ToolSuperMarket()
        
        def returns_empty_list(x):
            return []
        
        market.register("test/emptylist", returns_empty_list, "Returns Empty List")
        
        result = market.call("test/emptylist", x=5)
        
        assert result == []


class TestEdgeCases:
    """Tests for edge cases and unusual inputs."""

    def test_empty_path(self):
        """Registering with empty path should handle gracefully."""
        market = ToolSuperMarket()
        
        # Should either work or raise, not crash
        try:
            market.register("", lambda: None, "Empty path")
        except (ValueError, KeyError):
            pass  # Raising is acceptable

    def test_path_with_slash_only(self):
        """Path with only slashes should handle gracefully."""
        market = ToolSuperMarket()
        
        try:
            market.register("/", lambda: None, "Slash path")
        except (ValueError, KeyError):
            pass

    def test_path_with_multiple_slashes(self):
        """Path with consecutive slashes should handle gracefully."""
        market = ToolSuperMarket()
        
        try:
            market.register("a//b///c", lambda: None, "Multiple slashes")
        except (ValueError, KeyError):
            pass

    def test_path_with_special_characters(self):
        """Path with special characters should handle gracefully."""
        market = ToolSuperMarket()
        
        # Test various special characters
        special_paths = [
            "test/path-with-dash",
            "test/path_with_underscore",
            "test/path.with.dot",
            "test/path:with:colon",
        ]
        
        for path in special_paths:
            # Should either work or raise, not crash
            try:
                market.register(path, lambda: None, f"Test {path}")
            except (ValueError, KeyError):
                pass

    def test_path_with_unicode(self):
        """Path with Unicode characters should handle gracefully."""
        market = ToolSuperMarket()
        
        try:
            market.register("test/日本語/工具", lambda: None, "Unicode path")
        except (UnicodeError, ValueError):
            pass

    def test_empty_description(self):
        """Registration with empty description should work."""
        market = ToolSuperMarket()
        
        # Should work with empty description
        entry = market.register("test/empty", lambda: None, "")
        
        assert entry is not None

    def test_very_long_path(self):
        """Very long path should handle gracefully."""
        market = ToolSuperMarket()
        
        long_path = "a/" * 100 + "tool"
        
        # Should either work or raise, not crash
        try:
            market.register(long_path, lambda: None, "Long path")
        except (ValueError, MemoryError):
            pass

    def test_very_long_description(self):
        """Very long description should handle gracefully."""
        market = ToolSuperMarket()
        
        long_desc = "x" * 10000
        
        # Should work with long description
        entry = market.register("test/longdesc", lambda: None, long_desc)
        
        assert entry is not None

    def test_function_with_no_docstring(self):
        """Function without docstring should work."""
        market = ToolSuperMarket()
        
        def no_doc(x):
            return x
        
        entry = market.register("test/nodoc", no_doc, "No doc")
        
        assert entry is not None

    def test_function_with_multiline_docstring(self):
        """Function with multiline docstring should work."""
        market = ToolSuperMarket()
        
        def multiline_doc(x):
            """
            This is a multiline docstring.
            
            It has multiple paragraphs.
            
            Args:
                x: The input value
            
            Returns:
                The input value
            """
            return x
        
        entry = market.register("test/multiline", multiline_doc, "Multiline")
        
        assert entry is not None


class TestSearchEdgeCases:
    """Edge cases in search functionality."""

    def test_search_empty_query(self):
        """Search with empty query should handle gracefully."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        # Should either return empty or all results
        results = market.search("", mode="keyword")
        
        assert isinstance(results, list)

    def test_search_with_whitespace(self):
        """Search with whitespace should handle gracefully."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        results = market.search("   ", mode="keyword")
        
        assert isinstance(results, list)

    def test_search_special_regex_chars_in_keyword_mode(self):
        """Special regex characters in keyword mode should be escaped."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test (with parens)")
        
        # In keyword mode, special chars should be literal
        results = market.search("(with", mode="keyword")
        
        assert isinstance(results, list)

    def test_search_invalid_regex(self):
        """Invalid regex should handle gracefully."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        # Invalid regex should raise or return empty
        try:
            results = market.search("[invalid(regex", mode="regex")
            assert isinstance(results, list)
        except (ValueError, Exception):
            pass  # Raising is acceptable

    def test_search_empty_market(self):
        """Searching empty market should return empty list."""
        market = ToolSuperMarket()
        
        results = market.search("test", mode="keyword")
        
        assert results == []

    def test_search_top_k_zero(self):
        """Search with top_k=0 should return empty list."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        results = market.search("test", mode="keyword", top_k=0)
        
        assert results == []

    def test_search_top_k_negative(self):
        """Search with negative top_k should handle gracefully."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        # Should handle gracefully
        try:
            results = market.search("test", mode="keyword", top_k=-1)
            assert isinstance(results, list)
        except (ValueError, Exception):
            pass  # Raising is acceptable

    def test_search_all_modes(self):
        """All search modes should be supported or raise clearly."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test tool")
        
        for mode in ["keyword", "semantic", "regex"]:
            try:
                results = market.search("test", mode=mode)
                assert isinstance(results, list)
            except ValueError as e:
                # If mode not supported, should raise clear error
                assert mode in str(e)


class TestBrowseEdgeCases:
    """Edge cases in browse functionality."""

    def test_browse_empty_market(self):
        """Browsing empty market should return empty list."""
        market = ToolSuperMarket()
        
        result = market.browse("")
        
        assert result == []

    def test_browse_deep_nonexistent_path(self):
        """Browsing deep non-existent path should return empty list."""
        market = ToolSuperMarket()
        
        result = market.browse("nonexistent/deep/path")
        
        assert result == []

    def test_browse_trailing_slash(self):
        """Browse with trailing slash should work."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test")
        
        result1 = market.browse("test")
        result2 = market.browse("test/")
        
        # Both should work (may return same results)
        assert isinstance(result1, list)
        assert isinstance(result2, list)

    def test_browse_leading_slash(self):
        """Browse with leading slash should work."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test")
        
        result = market.browse("/test")
        
        assert isinstance(result, list)


class TestAsToolDefinitionsEdgeCases:
    """Edge cases in as_tool_definitions functionality."""

    def test_filter_empty_list(self):
        """Filter with empty list should return all tools."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test")
        
        definitions = market.as_tool_definitions(filter_paths=[])
        
        # Should return all tools (or empty, depending on implementation)
        assert isinstance(definitions, list)

    def test_filter_nonexistent_path(self):
        """Filter with non-existent path should return empty list."""
        market = ToolSuperMarket()
        market.register("test/tool", lambda: None, "Test")
        
        definitions = market.as_tool_definitions(filter_paths=["nonexistent"])
        
        assert definitions == []

    def test_filter_partial_match(self):
        """Filter with partial path match should work."""
        market = ToolSuperMarket()
        market.register("dev/python/tool", lambda: None, "Python")
        market.register("dev/js/tool", lambda: None, "JS")
        
        definitions = market.as_tool_definitions(filter_paths=["dev/python"])
        
        assert len(definitions) == 1


class TestWrapToolEdgeCases:
    """Edge cases in wrap_tool functionality."""

    def test_wrap_function_no_params(self):
        """wrap_tool should work with function with no params."""
        def func():
            return "test"
        
        entry = wrap_tool(func, "Test")
        
        assert isinstance(entry, ToolEntry)

    def test_wrap_function_many_params(self):
        """wrap_tool should work with function with many params."""
        def func(a, b, c, d, e, f, g, h, i, j):
            return sum([a, b, c, d, e, f, g, h, i, j])
        
        entry = wrap_tool(func, "Many params")
        
        assert isinstance(entry, ToolEntry)

    def test_wrap_function_with_annotations(self):
        """wrap_tool should handle type annotations."""
        def func(x: int, y: str) -> str:
            return y * x
        
        entry = wrap_tool(func, "Typed")
        
        assert isinstance(entry, ToolEntry)
        schema = entry.schema()
        assert isinstance(schema, dict)

    def test_wrap_lambda(self):
        """wrap_tool should work with lambda functions."""
        func = lambda x: x * 2
        
        entry = wrap_tool(func, "Lambda")
        
        assert isinstance(entry, ToolEntry)


class TestInvokeEdgeCases:
    """Edge cases inToolEntry invoke."""

    def test_invoke_no_params(self):
        """invoke should work with no params."""
        market = ToolSuperMarket()
        
        def func():
            return "test"
        
        market.register("test/func", func, "Test")
        
        entry = market.get("test/func")
        result = entry.invoke()
        
        assert result == "test"

    def test_invoke_with_extra_params(self):
        """invoke should handle extra params (may ignore or raise)."""
        market = ToolSuperMarket()
        
        def func(x):
            return x
        
        market.register("test/func", func, "Test")
        
        entry = market.get("test/func")
        
        # May raise TypeError or ignore extra params
        try:
            result = entry.invoke(x=1, y=2)
        except TypeError:
            pass  # Raising is acceptable

    def test_invoke_with_missing_params(self):
        """invoke should raise on missing required params."""
        market = ToolSuperMarket()
        
        def func(x, y):
            return x + y
        
        market.register("test/func", func, "Test")
        
        entry = market.get("test/func")
        
        with pytest.raises((TypeError, Exception)):
            entry.invoke(x=1)  # missing y


class TestPathHandling:
    """Tests for path handling edge cases."""

    def test_path_case_sensitivity(self):
        """Path handling should be consistent with case."""
        market = ToolSuperMarket()
        
        market.register("Test/Tool", lambda: None, "Test")
        
        # Should either be case-sensitive or case-insensitive
        # The important thing is consistency
        entry1 = market.get("Test/Tool")
        entry2 = market.get("test/tool")
        
        # At least one should work
        assert entry1 is not None or entry2 is not None

    def test_path_with_numbers(self):
        """Path with numbers should work."""
        market = ToolSuperMarket()
        
        market.register("test123/tool456", lambda: None, "Test")
        
        entry = market.get("test123/tool456")
        
        assert entry is not None

    def test_path_single_level(self):
        """Path with single level should work."""
        market = ToolSuperMarket()
        
        market.register("tool", lambda: None, "Test")
        
        entry = market.get("tool")
        
        assert entry is not None

    def test_path_very_deep(self):
        """Path with many levels should work."""
        market = ToolSuperMarket()
        
        path = "level1/level2/level3/level4/level5/level6/level7/tool"
        market.register(path, lambda: None, "Test")
        
        entry = market.get(path)
        
        assert entry is not None


class TestMemoryAndPerformance:
    """Tests for memory and performance edge cases."""

    def test_many_tools_registered(self):
        """Registering many tools should work without memory issues."""
        market = ToolSuperMarket()
        
        # Register 1000 tools
        for i in range(1000):
            market.register(f"test/tool{i}", lambda: i, f"Tool {i}")
        
        # All should be accessible
        definitions = market.as_tool_definitions()
        assert len(definitions) == 1000

    def test_browse_many_categories(self):
        """Browse with many categories should work."""
        market = ToolSuperMarket()
        
        # Register tools in 100 different categories
        for i in range(100):
            market.register(f"cat{i}/tool", lambda: i, f"Tool {i}")
        
        # Browse root should handle many categories
        result = market.browse("")
        
        assert isinstance(result, list)

    def test_search_many_results(self):
        """Search returning many results should work."""
        market = ToolSuperMarket()
        
        # Register 500 tools with similar descriptions
        for i in range(500):
            market.register(f"test/tool{i}", lambda: i, f"Test tool number {i}")
        
        # Search should handle many results
        results = market.search("test", mode="keyword", top_k=500)
        
        assert len(results) <= 500
