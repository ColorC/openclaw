# Design

### Requirement

A hierarchical tool registry that integrates with openhands-sdk. Agents can browse, search, and call registered tools dynamically.

### Constraints

- Must work with `openhands.sdk.Agent` and `register_tool()`
- Tool calls must not raise exceptions when used correctly
- Semantic search uses TF-IDF (no ML models)
- Thread-safe for concurrent access

### Architecture Decisions

#### ADR-001: Tool wrapper with callable

**Context:** Need to store both metadata and actual Python callable
**Decision:** `ToolEntry` stores `(metadata, callable, schema)` tuple
**Consequences:** Tools can be invoked directly, schema for LLM tool definition

#### ADR-002: Integration with openhands-sdk register_tool

**Context:** Need to expose supermarket tools to agents
**Decision:** `ToolSuperMarket.as_tool_definitions()` returns list of `ToolDefinition`
**Consequences:** Agents can use supermarket tools like any other tool

### Modules

#### ToolSuperMarket Core

Main facade and tool registry

- **Path:** `tool_supermarket/core.py`
- **Responsibilities:**
  - Register tools with callables and schemas
  - Hierarchical taxonomy management
  - Search and browse operations
  - Export to openhands-sdk ToolDefinition format

#### Tool Wrapper

Wrap Python functions as callable tools

- **Path:** `tool_supermarket/wrapper.py`
- **Responsibilities:**
  - Convert Python function to tool schema (via inspect)
  - Wrap callable with error handling
  - Generate JSON schema for parameters

#### Search Engine

TF-IDF based semantic search

- **Path:** `tool_supermarket/search.py`
- **Responsibilities:**
  - Build TF-IDF index over tool descriptions
  - Keyword and regex search
  - Return ranked results

### Interfaces

#### ToolSuperMarket

`class ToolSuperMarket`
Main facade for the tool market

#### register

`def register(self, path: str, func: Callable, description: str = "") -> ToolEntry`
Register a Python function as a tool at the given taxonomy path

#### browse

`def browse(self, path: str = "") -> list[str]`
List children at the given taxonomy path

#### search

`def search(self, query: str, mode: str = "keyword", top_k: int = 10) -> list[ToolEntry]`
Search tools by keyword, regex, or semantic similarity

#### get

`def get(self, path: str) -> ToolEntry | None`
Get a tool by its full path

#### call

`def call(self, path: str, **kwargs) -> Any`
Invoke a tool by path with given arguments

#### as_tool_definitions

`def as_tool_definitions(self, filter_paths: list[str] | None = None) -> list[ToolDefinition]`
Export tools as openhands-sdk ToolDefinitions for agent use

#### ToolEntry

`class ToolEntry`
Metadata and callable for a registered tool

#### path

`def path(self) -> str`
Full taxonomy path

#### schema

`def schema(self) -> dict`
JSON schema for the tool's parameters

#### invoke

`def invoke(self, **kwargs) -> Any`
Call the tool with arguments

#### wrap_tool

`def wrap_tool(func: Callable, description: str = "") -> ToolEntry`
Wrap a Python function as a ToolEntry with auto-generated schema

#### TfIdfSearch

`class TfIdfSearch`
TF-IDF based semantic search

#### index

`def index(self, entries: list[ToolEntry]) -> None`
Build index over tool entries

#### query

`def query(self, text: str, top_k: int = 10) -> list[tuple[ToolEntry, float]]`
Query the index, return (entry, score) pairs
