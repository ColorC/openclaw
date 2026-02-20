# ToolSuperMarket Extension

Dynamic tool discovery for AI agents.

## Installation

```bash
pip install -e ./python
```

## Usage

```python
from tool_supermarket import ToolSuperMarket, wrap_tool

# Create market
market = ToolSuperMarket()

# Register a Python function as a tool
def add(a: int, b: int) -> int:
    return a + b

market.register("software-dev/calculator/math/add", add, "Add two numbers")

# Browse taxonomy
market.browse("software-dev")  # ["software-dev/calculator"]

# Search tools
results = market.search("add numbers", mode="semantic")

# Call tool
result = market.call("software-dev/calculator/math/add", a=2, b=3)  # 5

# Export to openhands-sdk
definitions = market.as_tool_definitions()
```

## Architecture

- `community/department/job/tool` taxonomy
- TF-IDF semantic search
- Frequency tracking for favorites
- openhands-sdk integration
