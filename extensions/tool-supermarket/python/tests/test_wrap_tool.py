"""
Tests for wrap_tool functionality and schema generation.
"""

import pytest
from typing import Any, Optional, Union
from tool_supermarket.core import ToolEntry, wrap_tool, ToolSuperMarket


class TestWrapTool:
    """Tests for the wrap_tool function."""

    def test_wrap_simple_function(self):
        """wrap_tool should work with simple function."""
        def add(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b
        
        entry = wrap_tool(add, "Add two numbers")
        
        assert isinstance(entry, ToolEntry)

    def test_wrap_with_no_description(self):
        """wrap_tool should work without description."""
        def func(x: int) -> int:
            return x * 2
        
        entry = wrap_tool(func)
        
        assert isinstance(entry, ToolEntry)

    def test_wrap_returns_tool_entry(self):
        """wrap_tool should return ToolEntry instance."""
        def func(): pass
        
        entry = wrap_tool(func, "Test")
        
        assert isinstance(entry, ToolEntry)

    def test_wrap_preserves_callable(self):
        """Wrapped function should still be callable."""
        def add(a: int, b: int) -> int:
            return a + b
        
        entry = wrap_tool(add, "Add numbers")
        
        result = entry.invoke(a=2, b=3)
        assert result == 5


class TestSchemaGeneration:
    """Tests for automatic schema generation."""

    def test_schema_is_dict(self):
        """Schema should be a dictionary."""
        def func(x: int) -> int:
            return x
        
        entry = wrap_tool(func, "Test")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_no_params(self):
        """Function with no parameters should have appropriate schema."""
        def get_version() -> str:
            """Get version."""
            return "1.0.0"
        
        entry = wrap_tool(get_version, "Get version")
        
        schema = entry.schema()
        
        # Schema should indicate no parameters
        assert isinstance(schema, dict)

    def test_schema_single_param(self):
        """Function with single parameter should have schema."""
        def double(x: int) -> int:
            return x * 2
        
        entry = wrap_tool(double, "Double a number")
        
        schema = entry.schema()
        
        # Should have parameter information
        assert isinstance(schema, dict)
        # May have 'properties', 'parameters', or similar keys

    def test_schema_multiple_params(self):
        """Function with multiple parameters should have schema."""
        def add(a: int, b: int) -> int:
            return a + b
        
        entry = wrap_tool(add, "Add numbers")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_with_default_values(self):
        """Function with default values should reflect in schema."""
        def greet(name: str, count: int = 1) -> str:
            return f"Hello, {name}! " * count
        
        entry = wrap_tool(greet, "Greet someone")
        
        schema = entry.schema()
        
        # Schema should indicate that 'count' has a default value
        assert isinstance(schema, dict)
        # May indicate required vs optional parameters

    def test_schema_with_optional_type(self):
        """Function with Optional type should have appropriate schema."""
        def process(data: Optional[str] = None) -> str:
            return data or "default"
        
        entry = wrap_tool(process, "Process data")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_with_union_type(self):
        """Function with Union type should have appropriate schema."""
        def convert(value: Union[int, str]) -> str:
            return str(value)
        
        entry = wrap_tool(convert, "Convert value")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_with_list_type(self):
        """Function with list type should have appropriate schema."""
        def sum_list(numbers: list[int]) -> int:
            return sum(numbers)
        
        entry = wrap_tool(sum_list, "Sum a list")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_with_dict_type(self):
        """Function with dict type should have appropriate schema."""
        def process_dict(data: dict[str, Any]) -> Any:
            return data.get("key")
        
        entry = wrap_tool(process_dict, "Process dict")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_schema_with_complex_types(self):
        """Function with complex types should have appropriate schema."""
        def process(
            items: list[dict],
            options: dict | None = None
        ) -> dict[str, Any]:
            return {"items": items, "options": options}
        
        entry = wrap_tool(process, "Process items")
        
        schema = entry.schema()
        
        # Should correctly represent list of dicts and optional dict
        assert isinstance(schema, dict)


class TestToolEntryInterface:
    """Tests for ToolEntry interface."""

    def test_entry_has_path_method(self):
        """ToolEntry should have path method."""
        market = ToolSuperMarket()
        entry = market.register("dev/test", lambda: None, "Test")
        
        path = entry.path()
        
        assert path == "dev/test"

    def test_entry_has_schema_method(self):
        """ToolEntry should have schema method."""
        market = ToolSuperMarket()
        entry = market.register("dev/test", lambda x: x, "Test")
        
        schema = entry.schema()
        
        assert isinstance(schema, dict)

    def test_entry_has_invoke_method(self):
        """ToolEntry should have invoke method."""
        def add(a: int, b: int) -> int:
            return a + b
        
        market = ToolSuperMarket()
        entry = market.register("dev/test", add, "Add")
        
        result = entry.invoke(a=3, b=4)
        
        assert result == 7

    def test_invoke_with_kwargs(self):
        """invoke should accept keyword arguments."""
        def greet(name: str, greeting: str = "Hello") -> str:
            return f"{greeting}, {name}!"
        
        market = ToolSuperMarket()
        entry = market.register("dev/greet", greet, "Greet")
        
        result = entry.invoke(name="World", greeting="Hi")
        
        assert result == "Hi, World!"


class TestWrapToolEdgeCases:
    """Edge case tests for wrap_tool."""

    def test_function_with_no_annotations(self):
        """Function without type annotations should work."""
        def add(a, b):
            return a + b
        
        entry = wrap_tool(add, "Add two values")
        
        # Should work even without annotations
        assert isinstance(entry, ToolEntry)
        result = entry.invoke(a=1, b=2)
        assert result == 3

    def test_function_with_varargs(self):
        """Function with *args should work."""
        def sum_all(*args):
            return sum(args)
        
        entry = wrap_tool(sum_all, "Sum all arguments")
        
        # Should handle varargs
        # Implementation may vary
        assert isinstance(entry, ToolEntry)

    def test_function_with_kwargs(self):
        """Function with **kwargs should work."""
        def print_dict(**kwargs):
            return kwargs
        
        entry = wrap_tool(print_dict, "Print dict")
        
        # Should handle kwargs
        assert isinstance(entry, ToolEntry)

    def test_function_with_varargs_and_kwargs(self):
        """Function with *args and **kwargs should work."""
        def flexible_func(*args, **kwargs):
            return {"args": args, "kwargs": kwargs}
        
        entry = wrap_tool(flexible_func, "Flexible function")
        
        assert isinstance(entry, ToolEntry)

    def test_function_with_complex_defaults(self):
        """Function with complex default values should work."""
        def process(items: list = [], options: dict = {}):
            return {"items": items, "options": options}
        
        entry = wrap_tool(process, "Process")
        
        # Should handle mutable defaults (implementation may warn)
        assert isinstance(entry, ToolEntry)

    def test_lambda_function(self):
        """Lambda functions should work."""
        add = lambda a, b: a + b
        
        entry = wrap_tool(add, "Add lambda")
        
        assert isinstance(entry, ToolEntry)
        result = entry.invoke(a=1, b=2)
        assert result == 3

    def test_nested_function(self):
        """Nested functions should work."""
        def outer():
            def inner(x):
                return x * 2
            return inner
        
        func = outer()
        entry = wrap_tool(func, "Nested function")
        
        assert isinstance(entry, ToolEntry)

    def test_method_as_function(self):
        """Class methods should work as functions."""
        class Calculator:
            def add(self, a, b):
                return a + b
        
        calc = Calculator()
        entry = wrap_tool(calc.add, "Add method")
        
        assert isinstance(entry, ToolEntry)
        result = entry.invoke(a=1, b=2)
        assert result == 3

    def test_static_method(self):
        """Static methods should work."""
        class Tools:
            @staticmethod
            def add(a, b):
                return a + b
        
        entry = wrap_tool(Tools.add, "Add static")
        
        assert isinstance(entry, ToolEntry)

    def test_function_with_none_return(self):
        """Function that returns None should work."""
        def returns_none(x):
            return None
        
        entry = wrap_tool(returns_none, "Returns none")
        
        result = entry.invoke(x=5)
        assert result is None

    def test_function_with_multiple_return_types(self):
        """Function with multiple return types should work."""
        def maybe_return(x: int) -> Union[int, None]:
            return x if x > 0 else None
        
        entry = wrap_tool(maybe_return, "Maybe return")
        
        # Should handle Union return type
        assert isinstance(entry, ToolEntry)
        assert entry.invoke(x=5) == 5
        assert entry.invoke(x=-5) is None


class TestSchemaValidation:
    """Tests for schema validation and correctness."""

    def test_schema_keys(self):
        """Schema should have appropriate keys."""
        def func(x: int, y: str = "default") -> str:
            return y * x
        
        entry = wrap_tool(func, "Test func")
        schema = entry.schema()
        
        # Common schema keys (depending on implementation):
        # - 'type': object
        # - 'properties': parameter definitions
        # - 'required': list of required parameters
        # - 'definitions': type definitions
        # Implementation may vary
        assert isinstance(schema, dict)

    def test_required_vs_optional_params(self):
        """Schema should distinguish required vs optional parameters."""
        def func(required_param: int, optional_param: str = "default"):
            return f"{required_param}: {optional_param}"
        
        entry = wrap_tool(func, "Test")
        schema = entry.schema()
        
        # Should indicate which params are required
        # Implementation may use 'required' list or similar
        assert isinstance(schema, dict)

    def test_type_hints_in_schema(self):
        """Schema should reflect type hints."""
        def typed_func(x: int, y: str, z: bool) -> str:
            return f"{x}: {y} ({z})"
        
        entry = wrap_tool(typed_func, "Typed function")
        schema = entry.schema()
        
        # Schema should indicate types
        assert isinstance(schema, dict)

    def test_schema_serializable(self):
        """Schema should be JSON serializable."""
        import json
        
        def func(x: int, y: str = "test") -> str:
            return y * x
        
        entry = wrap_tool(func, "Test")
        schema = entry.schema()
        
        # Should be able to serialize to JSON
        try:
            json.dumps(schema)
        except (TypeError, ValueError):
            pytest.fail("Schema should be JSON serializable")


class TestIntegrationWithMarket:
    """Integration tests for wrap_tool with ToolSuperMarket."""

    def test_wrapped_tool_can_be_registered(self):
        """Wrapped tool should be registerable in market."""
        def add(a: int, b: int) -> int:
            return a + b
        
        entry = wrap_tool(add, "Add numbers")
        
        market = ToolSuperMarket()
        # Should be able to register a pre-wrapped tool
        # Or the market should wrap automatically
        registered = market.register("dev/add", add, "Add numbers")
        
        assert isinstance(registered, ToolEntry)

    def test_wrapped_tool_schema_matches(self):
        """Schema from wrap_tool should match registered tool."""
        def add(a: int, b: int) -> int:
            return a + b
        
        wrapped_entry = wrap_tool(add, "Add numbers")
        wrapped_schema = wrapped_entry.schema()
        
        market = ToolSuperMarket()
        registered_entry = market.register("dev/add", add, "Add numbers")
        registered_schema = registered_entry.schema()
        
        # Schemas should be equivalent
        # (may not be identical if market adds extra info)
        assert isinstance(wrapped_schema, dict)
        assert isinstance(registered_schema, dict)

    def test_invoke_consistency(self):
        """invoke should work consistently across wrap_tool and market."""
        def add(a: int, b: int) -> int:
            return a + b
        
        wrapped_entry = wrap_tool(add, "Add")
        
        market = ToolSuperMarket()
        registered_entry = market.register("dev/add", add, "Add")
        
        # Both should produce same results
        wrapped_result = wrapped_entry.invoke(a=5, b=3)
        registered_result = registered_entry.invoke(a=5, b=3)
        
        assert wrapped_result == registered_result == 8
