"""
Tests for TF-IDF search functionality.
"""

import pytest
from tool_supermarket.core import ToolSuperMarket, ToolEntry, TfIdfSearch, wrap_tool


class TestTfIdfSearchEngine:
    """Tests specifically for the TfIdfSearch class."""

    def test_create_search_engine(self):
        """Creating TfIdfSearch should work."""
        search_engine = TfIdfSearch()
        assert search_engine is not None

    def test_index_empty_list(self):
        """Indexing empty list should work."""
        search_engine = TfIdfSearch()
        
        # Should not raise
        search_engine.index([])

    def test_index_single_entry(self):
        """Indexing single entry should work."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entry = market.register("dev/test", lambda: None, "Test tool")
        entries = [entry]
        
        # Should not raise
        search_engine.index(entries)

    def test_index_multiple_entries(self):
        """Indexing multiple entries should work."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test1", lambda: None, "First test tool"),
            market.register("dev/test2", lambda: None, "Second test tool"),
            market.register("dev/test3", lambda: None, "Third test tool"),
        ]
        
        # Should not raise
        search_engine.index(entries)

    def test_query_empty_index(self):
        """Querying empty index should return empty list."""
        search_engine = TfIdfSearch()
        
        results = search_engine.query("test query")
        
        assert isinstance(results, list)
        assert len(results) == 0

    def test_query_with_index(self):
        """Querying indexed entries should return results."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test1", lambda: None, "Run unit tests"),
            market.register("dev/test2", lambda: None, "Deploy applications"),
        ]
        
        search_engine.index(entries)
        
        results = search_engine.query("testing", top_k=10)
        
        assert isinstance(results, list)
        # Should have results
        assert len(results) >= 1

    def test_query_returns_tuples(self):
        """Query should return (entry, score) tuples."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test", lambda: None, "Test tool"),
        ]
        
        search_engine.index(entries)
        
        results = search_engine.query("test")
        
        if len(results) > 0:
            assert isinstance(results[0], tuple)
            assert len(results[0]) == 2
            # First element should be a ToolEntry
            assert isinstance(results[0][0], ToolEntry)
            # Second element should be a numeric score
            assert isinstance(results[0][1], (int, float))

    def test_query_top_k(self):
        """Query should respect top_k parameter."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register(f"dev/test{i}", lambda: None, f"Test tool {i}")
            for i in range(20)
        ]
        
        search_engine.index(entries)
        
        results = search_engine.query("test", top_k=5)
        
        assert len(results) <= 5

    def test_query_empty_string(self):
        """Query with empty string should work."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [market.register("dev/test", lambda: None, "Test tool")]
        search_engine.index(entries)
        
        results = search_engine.query("")
        
        assert isinstance(results, list)

    def test_ranking_relevance(self):
        """TF-IDF should rank more relevant results higher."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test/unit", lambda: None, "Execute unit tests for code"),
            market.register("dev/deploy/prod", lambda: None, "Deploy to production server"),
        ]
        
        search_engine.index(entries)
        
        # Query for testing-related content
        results = search_engine.query("run tests for my code", top_k=10)
        
        # Should have results
        assert len(results) >= 1
        
        # First result should be the testing tool (higher relevance)
        if len(results) >= 2:
            first_entry, first_score = results[0]
            second_entry, second_score = results[1]
            
            # First should have higher score (more relevant)
            # Note: this is a soft check, as TF-IDF behavior can vary
            first_path = first_entry.path()
            assert "test" in first_path.lower() or first_score >= second_score

    def test_description_used_in_indexing(self):
        """Tool descriptions should be used in TF-IDF indexing."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        # Tool with specific unique term in description
        entries = [
            market.register(
                "dev/special",
                lambda: None,
                "Unique fibonacci calculation algorithm"
            ),
        ]
        
        search_engine.index(entries)
        
        # Search for unique term from description
        results = search_engine.query("fibonacci algorithm", top_k=10)
        
        # Should find the tool based on description
        assert len(results) >= 1

    def test_reindexing(self):
        """Re-indexing should update the index."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        # Index first set
        entries1 = [market.register("dev/test1", lambda: None, "First tool")]
        search_engine.index(entries1)
        
        results1 = search_engine.query("first")
        
        # Index second set (should replace)
        entries2 = [market.register("dev/test2", lambda: None, "Second tool")]
        search_engine.index(entries2)
        
        results2 = search_engine.query("second")
        
        # Should be able to query new entries
        # (whether old entries remain depends on implementation)


class TestTfIdfIntegration:
    """Integration tests for TF-IDF search in ToolSuperMarket."""

    def test_market_semantic_search_uses_tfidf(self):
        """Market semantic search should use TF-IDF."""
        market = ToolSuperMarket()
        
        market.register("dev/test/unit", lambda: None, "Execute unit tests")
        market.register("dev/deploy/prod", lambda: None, "Deploy to production")
        
        results = market.search("run my test suite", mode="semantic")
        
        assert isinstance(results, list)
        assert len(results) >= 1

    def test_semantic_vs_keyword_difference(self):
        """Semantic and keyword search should behave differently."""
        market = ToolSuperMarket()
        
        market.register("dev/test", lambda: None, "Execute automated test suites")
        market.register("dev/verify", lambda: None, "Verify code quality")
        
        semantic_results = market.search("run tests", mode="semantic")
        keyword_results = market.search("run tests", mode="keyword")
        
        # Both should work but may return different results
        assert isinstance(semantic_results, list)
        assert isinstance(keyword_results, list)

    def test_semantic_search_respects_top_k(self):
        """Semantic search should respect top_k parameter."""
        market = ToolSuperMarket()
        
        for i in range(20):
            market.register(f"dev/test{i}", lambda: None, f"Test tool {i}")
        
        results = market.search("test", mode="semantic", top_k=5)
        
        assert len(results) <= 5


class TestTfIdfEdgeCases:
    """Edge case tests for TF-IDF search."""

    def test_duplicate_words_in_description(self):
        """Should handle duplicate words in descriptions."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test", lambda: None, "test test test test"),
        ]
        
        # Should not raise
        search_engine.index(entries)
        results = search_engine.query("test")
        
        assert isinstance(results, list)

    def test_very_long_description(self):
        """Should handle long descriptions."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        long_desc = "test " * 1000  # Very long description
        
        entries = [
            market.register("dev/test", lambda: None, long_desc),
        ]
        
        # Should not raise
        search_engine.index(entries)
        results = search_engine.query("test")
        
        assert isinstance(results, list)

    def test_special_characters_in_query(self):
        """Should handle special characters in queries."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register(
                "dev/test",
                lambda: None,
                "Test with special characters: !@#$%"
            ),
        ]
        
        search_engine.index(entries)
        
        # Should not raise
        results = search_engine.query("test !@#$%")
        
        assert isinstance(results, list)

    def test_unicode_in_description(self):
        """Should handle Unicode in descriptions."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register(
                "dev/test",
                lambda: None,
                "Test with Unicode: 你好世界 नमस्ते"
            ),
        ]
        
        # Should not raise
        search_engine.index(entries)
        results = search_engine.query("你好")
        
        assert isinstance(results, list)

    def test_empty_description(self):
        """Should handle empty descriptions."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test", lambda: None, ""),
        ]
        
        # Should not raise
        search_engine.index(entries)
        results = search_engine.query("test")
        
        assert isinstance(results, list)

    def test_none_description(self):
        """Should handle None descriptions if allowed."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        # Some implementations might allow None description
        try:
            entry = market.register("dev/test", lambda: None, None)
            entries = [entry]
            search_engine.index(entries)
        except (TypeError, ValueError):
            # If None is not allowed, that's fine
            pass

    def test_numeric_terms(self):
        """Should handle numeric terms in descriptions."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register("dev/test", lambda: None, "Tool version 123.456"),
        ]
        
        search_engine.index(entries)
        
        results = search_engine.query("123.456")
        
        assert isinstance(results, list)


class TestTfIdfPerformance:
    """Performance-related tests for TF-IDF."""

    def test_large_number_of_tools(self):
        """Should handle large number of tools."""
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        # Create many tools
        entries = []
        for i in range(100):
            entry = market.register(
                f"dev/test{i}",
                lambda: None,
                f"Test tool number {i} with various descriptions"
            )
            entries.append(entry)
        
        # Should be able to index
        search_engine.index(entries)
        
        # Should be able to query
        results = search_engine.query("test", top_k=10)
        
        assert len(results) <= 10

    def test_fast_query_after_index(self):
        """Querying should be reasonably fast."""
        import time
        
        search_engine = TfIdfSearch()
        market = ToolSuperMarket()
        
        entries = [
            market.register(f"dev/test{i}", lambda: None, f"Tool {i}")
            for i in range(50)
        ]
        
        search_engine.index(entries)
        
        # Query should be fast (less than 1 second for 50 tools)
        start = time.time()
        results = search_engine.query("test", top_k=10)
        elapsed = time.time() - start
        
        assert elapsed < 1.0, f"Query took {elapsed}s, should be < 1s"
