"""
ToolSuperMarket - A hierarchical tool registry for openhands-sdk.

Provides tool registration, browsing, searching (keyword, regex, TF-IDF semantic),
and export to openhands-sdk ToolDefinition format.
"""

from __future__ import annotations

import inspect
import math
import re
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Union, get_type_hints


@dataclass
class ToolEntry:
    """Metadata and callable for a registered tool."""
    
    _path: str = ""
    _func: Callable = field(default_factory=lambda: lambda: None)
    _description: str = ""
    _schema: dict = field(default_factory=dict)
    _access_count: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)
    
    def path(self) -> str:
        """Full taxonomy path."""
        return self._path
    
    def schema(self) -> dict:
        """JSON schema for the tool's parameters."""
        return self._schema
    
    def invoke(self, **kwargs) -> Any:
        """Call the tool with arguments."""
        with self._lock:
            self._access_count += 1
        return self._func(**kwargs)
    
    def get_access_count(self) -> int:
        """Get the number of times this tool has been called."""
        with self._lock:
            return self._access_count
    
    @property
    def description(self) -> str:
        """Tool description."""
        return self._description
    
    @property
    def func(self) -> Callable:
        """The underlying function."""
        return self._func


def _generate_schema(func: Callable) -> dict:
    """Generate a JSON schema from a function's signature and type hints."""
    try:
        sig = inspect.signature(func)
        hints = get_type_hints(func) if hasattr(func, '__annotations__') else {}
    except Exception:
        # Fallback for functions where introspection fails
        return {"type": "object", "properties": {}, "required": []}
    
    properties = {}
    required = []
    
    for param_name, param in sig.parameters.items():
        # Skip self for methods
        if param_name == 'self':
            continue
        
        prop_schema = {"type": "object"}  # Default type
        
        # Get type hint
        hint = hints.get(param_name)
        if hint is not None:
            prop_schema = _type_hint_to_schema(hint)
        
        # Check if parameter has a default value
        if param.default is inspect.Parameter.empty:
            required.append(param_name)
        else:
            prop_schema["default"] = param.default
        
        properties[param_name] = prop_schema
    
    return {
        "type": "object",
        "properties": properties,
        "required": required
    }


def _type_hint_to_schema(hint) -> dict:
    """Convert a Python type hint to JSON schema."""
    origin = getattr(hint, '__origin__', None)
    
    # Handle Optional[X] (Union[X, None])
    if origin is Union:
        args = getattr(hint, '__args__', ())
        non_none_args = [a for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            return _type_hint_to_schema(non_none_args[0])
        # Multiple non-None types
        return {"type": "object", "anyOf": [_type_hint_to_schema(a) for a in non_none_args]}
    
    # Handle list[X]
    if origin is list or hint is list:
        args = getattr(hint, '__args__', ())
        if args:
            return {"type": "array", "items": _type_hint_to_schema(args[0])}
        return {"type": "array"}
    
    # Handle dict[K, V]
    if origin is dict or hint is dict:
        args = getattr(hint, '__args__', ())
        if len(args) >= 2:
            return {
                "type": "object",
                "additionalProperties": _type_hint_to_schema(args[1])
            }
        return {"type": "object"}
    
    # Basic types
    if hint is str:
        return {"type": "string"}
    elif hint is int:
        return {"type": "integer"}
    elif hint is float:
        return {"type": "number"}
    elif hint is bool:
        return {"type": "boolean"}
    elif hint is Any:
        return {"type": "object"}
    
    return {"type": "object"}


def wrap_tool(func: Callable, description: str = "") -> ToolEntry:
    """Wrap a Python function as a ToolEntry with auto-generated schema."""
    schema = _generate_schema(func)
    return ToolEntry(
        _path="",  # Path will be set when registered
        _func=func,
        _description=description or (func.__doc__ or ""),
        _schema=schema
    )


class TfIdfSearch:
    """TF-IDF based semantic search."""
    
    def __init__(self):
        self._entries: list[ToolEntry] = []
        self._idf: dict[str, float] = {}
        self._tf: dict[int, dict[str, float]] = {}
        self._documents: dict[int, list[str]] = {}
        self._lock = threading.Lock()
    
    def index(self, entries: list[ToolEntry]) -> None:
        """Build index over tool entries."""
        with self._lock:
            self._entries = list(entries)
            self._idf = {}
            self._tf = {}
            self._documents = {}
            
            if not self._entries:
                return
            
            # Tokenize all documents
            doc_freq: dict[str, int] = defaultdict(int)
            
            for i, entry in enumerate(self._entries):
                # Combine path and description for indexing
                text = f"{entry._path} {entry._description}"
                tokens = self._tokenize(text)
                self._documents[i] = tokens
                
                # Count document frequency
                unique_tokens = set(tokens)
                for token in unique_tokens:
                    doc_freq[token] += 1
            
            # Calculate IDF
            num_docs = len(self._entries)
            for token, freq in doc_freq.items():
                self._idf[token] = math.log(num_docs / (1 + freq)) + 1
            
            # Calculate TF for each document
            for i, tokens in self._documents.items():
                self._tf[i] = {}
                token_counts: dict[str, int] = defaultdict(int)
                for token in tokens:
                    token_counts[token] += 1
                
                max_count = max(token_counts.values()) if token_counts else 1
                for token, count in token_counts.items():
                    self._tf[i][token] = count / max_count
    
    def _tokenize(self, text: str) -> list[str]:
        """Tokenize text for TF-IDF."""
        # Convert to lowercase and split on non-alphanumeric
        text = text.lower()
        tokens = re.findall(r'[a-z0-9]+', text)
        return tokens
    
    def query(self, text: str, top_k: int = 10) -> list[tuple[ToolEntry, float]]:
        """Query the index, return (entry, score) pairs."""
        with self._lock:
            if not self._entries:
                return []
            
            query_tokens = self._tokenize(text)
            if not query_tokens:
                return [(entry, 0.0) for entry in self._entries[:top_k]]
            
            scores = []
            
            for i, entry in enumerate(self._entries):
                score = self._score_document(i, query_tokens)
                scores.append((entry, score))
            
            # Sort by score descending
            scores.sort(key=lambda x: x[1], reverse=True)
            
            return scores[:top_k]
    
    def _score_document(self, doc_idx: int, query_tokens: list[str]) -> float:
        """Calculate TF-IDF score for a document."""
        score = 0.0
        doc_tf = self._tf.get(doc_idx, {})
        
        for token in query_tokens:
            if token in doc_tf:
                tf = doc_tf[token]
                idf = self._idf.get(token, 1.0)
                score += tf * idf
        
        return score


@dataclass
class ToolDefinition:
    """A tool definition compatible with openhands-sdk."""
    name: str
    description: str
    parameters: dict
    callable: Callable


class ToolSuperMarket:
    """Main facade for the tool market."""
    
    def __init__(self):
        self._tools: dict[str, ToolEntry] = {}
        self._lock = threading.RLock()  # Reentrant lock for nested calls
        self._search_engine = TfIdfSearch()
    
    def register(self, path: str, func: Callable, description: str = "") -> ToolEntry:
        """Register a Python function as a tool at the given taxonomy path."""
        # Normalize path
        path = self._normalize_path(path)
        
        schema = _generate_schema(func)
        entry = ToolEntry(
            _path=path,
            _func=func,
            _description=description or (func.__doc__ or ""),
            _schema=schema
        )
        
        with self._lock:
            self._tools[path] = entry
            self._search_engine.index(list(self._tools.values()))
        
        return entry
    
    def _normalize_path(self, path: str) -> str:
        """Normalize a path by removing leading/trailing slashes and collapsing multiple slashes."""
        # Remove leading and trailing slashes
        path = path.strip('/')
        # Collapse multiple consecutive slashes
        while '//' in path:
            path = path.replace('//', '/')
        return path
    
    def browse(self, path: str = "") -> list[str]:
        """List children at the given taxonomy path."""
        path = self._normalize_path(path)
        
        with self._lock:
            children: set[str] = set()
            path_prefix = path + '/' if path else ""
            
            for tool_path in self._tools.keys():
                if path:
                    # Check if tool is under this path
                    if not tool_path.startswith(path_prefix):
                        continue
                    remainder = tool_path[len(path_prefix):]
                else:
                    remainder = tool_path
                
                # Get the next component
                parts = remainder.split('/')
                if parts:
                    child_path = path_prefix + parts[0] if path else parts[0]
                    children.add(child_path)
            
            return sorted(children)
    
    def search(self, query: str, mode: str = "keyword", top_k: int = 10) -> list[ToolEntry]:
        """Search tools by keyword, regex, or semantic similarity."""
        mode = mode.lower()
        
        with self._lock:
            if not self._tools:
                return []
            
            if mode == "keyword":
                return self._search_keyword(query, top_k)
            elif mode == "regex":
                return self._search_regex(query, top_k)
            elif mode == "semantic":
                return self._search_semantic(query, top_k)
            else:
                # Unknown mode, return empty or raise
                return []
    
    def _search_keyword(self, query: str, top_k: int) -> list[ToolEntry]:
        """Keyword search in paths and descriptions."""
        query_lower = query.lower()
        results = []
        
        for entry in self._tools.values():
            # Search in path and description
            if (query_lower in entry._path.lower() or 
                query_lower in entry._description.lower()):
                results.append(entry)
        
        return results[:top_k]
    
    def _search_regex(self, query: str, top_k: int) -> list[ToolEntry]:
        """Regex search in paths and descriptions."""
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            return []
        
        results = []
        
        for entry in self._tools.values():
            if (pattern.search(entry._path) or 
                pattern.search(entry._description)):
                results.append(entry)
        
        return results[:top_k]
    
    def _search_semantic(self, query: str, top_k: int) -> list[ToolEntry]:
        """Semantic search using TF-IDF."""
        scored = self._search_engine.query(query, top_k)
        return [entry for entry, score in scored]
    
    def get(self, path: str) -> ToolEntry | None:
        """Get a tool by its full path."""
        path = self._normalize_path(path)
        
        with self._lock:
            return self._tools.get(path)
    
    def call(self, path: str, **kwargs) -> Any:
        """Invoke a tool by path with given arguments."""
        path = self._normalize_path(path)
        
        with self._lock:
            entry = self._tools.get(path)
        
        if entry is None:
            raise KeyError(f"Tool not found: {path}")
        
        return entry.invoke(**kwargs)
    
    def as_tool_definitions(self, filter_paths: list[str] | None = None) -> list[ToolDefinition]:
        """Export tools as openhands-sdk ToolDefinitions for agent use."""
        with self._lock:
            tools_to_export = []
            
            if filter_paths is None:
                tools_to_export = list(self._tools.values())
            else:
                # Normalize filter paths
                normalized_filters = [self._normalize_path(p) for p in filter_paths]
                
                for path, entry in self._tools.items():
                    for filter_path in normalized_filters:
                        if path.startswith(filter_path + '/') or path == filter_path:
                            tools_to_export.append(entry)
                            break
            
            definitions = []
            for entry in tools_to_export:
                # Use last component of path as name, or full path if no slashes
                name = entry._path.split('/')[-1] if '/' in entry._path else entry._path
                
                definition = ToolDefinition(
                    name=name,
                    description=entry._description,
                    parameters=entry._schema,
                    callable=entry._func
                )
                definitions.append(definition)
            
            return definitions
