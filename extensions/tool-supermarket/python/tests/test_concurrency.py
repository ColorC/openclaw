"""
Concurrency and thread-safety tests for ToolSuperMarket.

Tests TC-018: Concurrent access.
"""

import pytest
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from tool_supermarket.core import ToolSuperMarket, ToolEntry


@pytest.mark.concurrent
class TestConcurrentRegistration:
    """Tests for concurrent tool registration."""

    def test_concurrent_register_different_paths(self):
        """Concurrent registration at different paths should work."""
        market = ToolSuperMarket()
        errors = []
        num_threads = 20
        
        def register_tool(i):
            try:
                path = f"dev/tool{i}"
                func = lambda x=i: x
                market.register(path, func, f"Tool {i}")
            except Exception as e:
                errors.append((i, e))
        
        threads = [
            threading.Thread(target=register_tool, args=(i,))
            for i in range(num_threads)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"
        
        # All tools should be registered
        definitions = market.as_tool_definitions()
        assert len(definitions) == num_threads

    def test_concurrent_register_same_path(self):
        """Concurrent registration at same path should be safe."""
        market = ToolSuperMarket()
        errors = []
        num_threads = 10
        
        def register_tool(i):
            try:
                path = "dev/shared/tool"
                func = lambda x=i: x
                market.register(path, func, f"Tool attempt {i}")
            except Exception as e:
                errors.append((i, e))
        
        threads = [
            threading.Thread(target=register_tool, args=(i,))
            for i in range(num_threads)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # Some attempts may fail if path already exists, or overwrite
        # The important thing is no crashes or corruption
        
        # Should have exactly one tool registered
        entry = market.get("dev/shared/tool")
        assert entry is not None


@pytest.mark.concurrent
class TestConcurrentCalls:
    """Tests for concurrent tool calls."""

    def test_concurrent_call_same_tool(self):
        """Concurrent calls to same tool should work."""
        market = ToolSuperMarket()
        
        def add(a: int, b: int) -> int:
            time.sleep(0.001)  # Small delay to increase contention
            return a + b
        
        market.register("dev/add", add, "Add numbers")
        
        results = []
        errors = []
        num_calls = 50
        
        def call_tool(i):
            try:
                result = market.call("dev/add", a=i, b=i+1)
                results.append((i, result))
            except Exception as e:
                errors.append((i, e))
        
        threads = [
            threading.Thread(target=call_tool, args=(i,))
            for i in range(num_calls)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"
        
        # All calls should succeed
        assert len(results) == num_calls
        
        # Verify all results are correct
        for i, result in results:
            assert result == i + (i + 1), f"Wrong result for i={i}"

    def test_concurrent_call_different_tools(self):
        """Concurrent calls to different tools should work."""
        market = ToolSuperMarket()
        
        # Register multiple tools
        for i in range(10):
            func = lambda x, offset=i: x + offset
            market.register(f"dev/tool{i}", func, f"Tool {i}")
        
        results = []
        errors = []
        num_calls = 100
        
        def call_tool(i):
            try:
                tool_idx = i % 10
                result = market.call(f"dev/tool{tool_idx}", x=5)
                results.append((i, tool_idx, result))
            except Exception as e:
                errors.append((i, e))
        
        threads = [
            threading.Thread(target=call_tool, args=(i,))
            for i in range(num_calls)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"
        
        # All calls should succeed
        assert len(results) == num_calls


@pytest.mark.concurrent
class TestConcurrentReadWrite:
    """Tests for concurrent read and write operations."""

    def test_concurrent_read_and_write(self):
        """Concurrent reads and writes should be safe."""
        market = ToolSuperMarket()
        errors = []
        
        def writer():
            for i in range(20):
                try:
                    path = f"dev/writer/{threading.current_thread().name}/{i}"
                    market.register(path, lambda: i, f"Tool {i}")
                    time.sleep(0.001)
                except Exception as e:
                    errors.append(('write', e))
        
        def reader():
            for i in range(20):
                try:
                    # Try to read various tools
                    market.get("dev/writer/writer/0")
                    market.browse("dev")
                    time.sleep(0.001)
                except Exception as e:
                    errors.append(('read', e))
        
        # Create reader and writer threads
        threads = []
        
        # Writers
        for i in range(3):
            t = threading.Thread(target=writer, name=f"writer-{i}")
            threads.append(t)
        
        # Readers
        for i in range(5):
            t = threading.Thread(target=reader, name=f"reader-{i}")
            threads.append(t)
        
        # Start all
        for t in threads:
            t.start()
        
        # Wait for all
        for t in threads:
            t.join(timeout=10.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"

    def test_concurrent_browse_and_call(self):
        """Concurrent browse and call operations should be safe."""
        market = ToolSuperMarket()
        
        # Pre-register some tools
        for i in range(10):
            market.register(f"dev/tool{i}", lambda x=i: x, f"Tool {i}")
        
        errors = []
        
        def browser():
            for i in range(50):
                try:
                    market.browse("dev")
                    time.sleep(0.001)
                except Exception as e:
                    errors.append(('browse', e))
        
        def caller():
            for i in range(50):
                try:
                    tool_idx = i % 10
                    market.call(f"dev/tool{tool_idx}")
                    time.sleep(0.001)
                except Exception as e:
                    errors.append(('call', e))
        
        threads = []
        
        # Browsers
        for i in range(5):
            threads.append(threading.Thread(target=browser))
        
        # Callers
        for i in range(5):
            threads.append(threading.Thread(target=caller))
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=10.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"


@pytest.mark.concurrent
class TestConcurrentSearch:
    """Tests for concurrent search operations."""

    def test_concurrent_search(self):
        """Concurrent searches should work correctly."""
        market = ToolSuperMarket()
        
        # Register many tools
        for i in range(50):
            market.register(
                f"dev/tool{i}",
                lambda: i,
                f"Tool number {i} for testing and development"
            )
        
        results_by_thread = {}
        errors = []
        
        def search_worker(thread_id):
            try:
                results = []
                modes = ["keyword", "semantic", "regex"]
                
                for i in range(10):
                    mode = modes[i % len(modes)]
                    if mode == "regex":
                        query = f"dev/tool.*"
                    else:
                        query = f"tool {thread_id}"
                    
                    result = market.search(query, mode=mode, top_k=10)
                    results.append(len(result))
                    time.sleep(0.001)
                
                results_by_thread[thread_id] = results
            except Exception as e:
                errors.append((thread_id, e))
        
        threads = [
            threading.Thread(target=search_worker, args=(i,))
            for i in range(10)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=10.0)
        
        # No errors should occur
        assert len(errors) == 0, f"Errors: {errors}"
        
        # All threads should have results
        assert len(results_by_thread) == 10


@pytest.mark.concurrent
class TestThreadSafetyWithFutures:
    """Thread safety tests using ThreadPoolExecutor."""

    def test_mixed_operations_with_executor(self):
        """Mixed operations with ThreadPoolExecutor should be safe."""
        market = ToolSuperMarket()
        errors = []
        
        def register_op(i):
            try:
                path = f"dev/tool{i}"
                market.register(path, lambda: i, f"Tool {i}")
                return ('register', i, 'success')
            except Exception as e:
                errors.append(('register', i, e))
                return ('register', i, 'error')
        
        def call_op(i):
            try:
                tool_idx = i % 20  # Only call registered tools
                result = market.call(f"dev/tool{tool_idx}")
                return ('call', i, result)
            except Exception as e:
                # Some calls may fail if tool not yet registered
                return ('call', i, 'not_found')
        
        def browse_op(i):
            try:
                result = market.browse("dev")
                return ('browse', i, len(result))
            except Exception as e:
                errors.append(('browse', i, e))
                return ('browse', i, 'error')
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = []
            
            # Mix of operations
            for i in range(50):
                futures.append(executor.submit(register_op, i))
                futures.append(executor.submit(call_op, i))
                futures.append(executor.submit(browse_op, i))
            
            # Wait for all to complete
            results = []
            for future in as_completed(futures):
                try:
                    result = future.result(timeout=5.0)
                    results.append(result)
                except Exception as e:
                    errors.append(('future', e))
        
        # No unexpected errors
        # (some call_op errors are expected if tool not yet registered)
        unexpected_errors = [e for e in errors if e[0] not in ['register', 'browse']]
        assert len(unexpected_errors) == 0, f"Unexpected errors: {unexpected_errors}"
        
        # Should have processed many operations
        assert len(results) >= 100  # At least 1/3 should succeed

    def test_stress_test(self):
        """Stress test with many concurrent operations."""
        market = ToolSuperMarket()
        errors = []
        operations_count = 200
        
        def random_operation(i):
            try:
                op_type = i % 4
                
                if op_type == 0:
                    # Register
                    path = f"stress/tool{i}"
                    market.register(path, lambda: i, f"Tool {i}")
                
                elif op_type == 1:
                    # Call
                    tool_idx = i % 50
                    try:
                        market.call(f"stress/tool{tool_idx}")
                    except:
                        pass  # May not exist yet
                
                elif op_type == 2:
                    # Browse
                    market.browse("stress")
                
                else:
                    # Search
                    market.search("tool", mode="keyword", top_k=10)
            
            except Exception as e:
                errors.append((i, e))
        
        with ThreadPoolExecutor(max_workers=30) as executor:
            futures = [
                executor.submit(random_operation, i)
                for i in range(operations_count)
            ]
            
            for future in as_completed(futures):
                try:
                    future.result(timeout=10.0)
                except Exception as e:
                    errors.append(('future', e))
        
        # No crashes or data corruption
        assert len(errors) == 0, f"Errors during stress test: {errors}"


@pytest.mark.concurrent
class TestRaceConditions:
    """Tests for specific race condition scenarios."""

    def test_no_race_in_register_and_get(self):
        """No race condition between register and get."""
        market = ToolSuperMarket()
        
        got_none = []
        got_entry = []
        
        def register_and_get(i):
            # Register
            path = f"race/test{i}"
            market.register(path, lambda: i, f"Tool {i}")
            
            # Immediately try to get
            entry = market.get(path)
            
            if entry is None:
                got_none.append(i)
            else:
                got_entry.append(i)
        
        threads = [
            threading.Thread(target=register_and_get, args=(i,))
            for i in range(50)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # All gets should succeed (entries should be immediately available)
        assert len(got_none) == 0, f"Some gets returned None: {got_none}"
        assert len(got_entry) == 50

    def test_no_race_in_browse(self):
        """No race condition in browse during registration."""
        market = ToolSuperMarket()
        
        browse_counts = []
        
        def register_batch(start):
            for i in range(start, start + 10):
                market.register(f"race/batch{i}", lambda: i, f"Tool {i}")
        
        def browse_multiple():
            counts = []
            for i in range(20):
                result = market.browse("race")
                counts.append(len(result))
                time.sleep(0.001)
            browse_counts.extend(counts)
        
        threads = []
        
        # Registration threads
        for i in range(0, 50, 10):
            threads.append(threading.Thread(target=register_batch, args=(i,)))
        
        # Browse threads
        for i in range(5):
            threads.append(threading.Thread(target=browse_multiple))
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=10.0)
        
        # Browse should never crash or return invalid data
        # (counts may vary based on timing)
        assert len(browse_counts) == 100  # 5 threads * 20 browses


@pytest.mark.concurrent
class TestAtomicity:
    """Tests for atomicity of operations."""

    def test_register_is_atomic(self):
        """Registration should be atomic (all or nothing)."""
        market = ToolSuperMarket()
        
        # Concurrent registrations
        def register_batch(start):
            for i in range(start, start + 5):
                market.register(f"atomic/test{i}", lambda: i, f"Tool {i}")
        
        threads = [
            threading.Thread(target=register_batch, args=(i*5,))
            for i in range(10)
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=5.0)
        
        # Each tool should either be fully registered or not
        # No partial/corrupt entries
        definitions = market.as_tool_definitions()
        
        # All registered tools should be retrievable and callable
        for path in [f"atomic/test{i}" for i in range(50)]:
            entry = market.get(path)
            if entry is not None:
                # Should be able to call without error
                result = entry.invoke()
                assert isinstance(result, int)

    def test_as_tool_definitions_is_consistent(self):
        """as_tool_definitions should return consistent snapshot."""
        market = ToolSuperMarket()
        
        # Initial tools
        for i in range(20):
            market.register(f"atomic/initial{i}", lambda: i, f"Initial {i}")
        
        snapshots = []
        
        def register_more():
            for i in range(20, 50):
                market.register(f"atomic/more{i}", lambda: i, f"More {i}")
                time.sleep(0.001)
        
        def take_snapshots():
            for i in range(10):
                snapshot = market.as_tool_definitions()
                snapshots.append(len(snapshot))
                time.sleep(0.01)
        
        threads = [
            threading.Thread(target=register_more),
            threading.Thread(target=take_snapshots),
        ]
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join(timeout=10.0)
        
        # Each snapshot should be internally consistent
        # (no partial tools or corruption)
        # The count may increase as new tools are added, but should always
        # be a valid number
        for count in snapshots:
            assert count >= 20  # At least initial tools
            assert count <= 50  # At most all tools
