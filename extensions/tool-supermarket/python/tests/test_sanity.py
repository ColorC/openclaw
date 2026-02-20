"""
Sanity check tests to verify the test infrastructure.
"""

import pytest


def test_imports():
    """Verify that we can import the module under test."""
    try:
        from tool_supermarket import core
        assert core is not None
    except ImportError as e:
        pytest.fail(f"Could not import tool_supermarket.core: {e}")


def test_classes_exist():
    """Verify that expected classes exist."""
    try:
        from tool_supermarket.core import ToolSuperMarket, ToolEntry, TfIdfSearch
        
        # Classes should exist
        assert ToolSuperMarket is not None
        assert ToolEntry is not None
        assert TfIdfSearch is not None
        
    except ImportError as e:
        pytest.fail(f"Could not import classes: {e}")


def test_functions_exist():
    """Verify that expected functions exist."""
    try:
        from tool_supermarket.core import wrap_tool
        
        # Function should exist
        assert wrap_tool is not None
        
    except ImportError as e:
        pytest.fail(f"Could not import functions: {e}")


def test_stub_implementations():
    """Verify that stub implementations raise NotImplementedError."""
    from tool_supermarket.core import ToolSuperMarket, ToolEntry, TfIdfSearch
    
    # ToolSuperMarket methods should raise NotImplementedError
    market = ToolSuperMarket()
    
    with pytest.raises(NotImplementedError):
        market.register("test", lambda: None, "Test")
    
    with pytest.raises(NotImplementedError):
        market.browse("test")
    
    with pytest.raises(NotImplementedError):
        market.search("test")
    
    with pytest.raises(NotImplementedError):
        market.get("test")
    
    with pytest.raises(NotImplementedError):
        market.call("test")
    
    with pytest.raises(NotImplementedError):
        market.as_tool_definitions()
    
    # ToolEntry methods should raise NotImplementedError
    entry = ToolEntry()
    
    with pytest.raises(NotImplementedError):
        entry.path()
    
    with pytest.raises(NotImplementedError):
        entry.schema()
    
    with pytest.raises(NotImplementedError):
        entry.invoke()
    
    # TfIdfSearch methods should raise NotImplementedError
    search = TfIdfSearch()
    
    with pytest.raises(NotImplementedError):
        search.index([])
    
    with pytest.raises(NotImplementedError):
        search.query("test")


def test_pytest_works():
    """Simple test to verify pytest is working."""
    assert True


def test_fixtures_available(empty_market, populated_market):
    """Test that fixtures are available."""
    # These should be None or raise because implementations are stubs
    # But fixtures should be available
    assert empty_market is not None
    assert populated_market is not None
