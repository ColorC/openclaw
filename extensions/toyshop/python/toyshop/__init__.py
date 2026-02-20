"""ToyShop - Software factory with OpenSpec contracts and OpenHands LLM."""

# Legacy API (will be deprecated)
from toyshop.llm import create_llm, chat_with_tool
from toyshop.pipeline import run_development_pipeline, DevelopmentPipelineState

# New Agent-based API
from toyshop.agent import (
    create_toyshop_agent,
    create_toyshop_llm,
    ToyShopConversation,
    run_toyshop_workflow,
)

# UX Agent
from toyshop.ux_agent import (
    create_ux_agent,
    run_ux_evaluation,
    UXTestResult,
    UxEvaluationMode,
)

# Coding Agent
from toyshop.coding_agent import (
    create_coding_agent,
    run_coding_workflow,
    run_full_pipeline_with_coding,
    CodingResult,
)

# TDD Pipeline
from toyshop.tdd_pipeline import (
    run_tdd_pipeline,
    TDDResult,
)

__all__ = [
    # Legacy
    "create_llm",
    "chat_with_tool",
    "run_development_pipeline",
    "DevelopmentPipelineState",
    # New Agent API
    "create_toyshop_agent",
    "create_toyshop_llm",
    "ToyShopConversation",
    "run_toyshop_workflow",
    # UX Agent
    "create_ux_agent",
    "run_ux_evaluation",
    "UXTestResult",
    "UxEvaluationMode",
    # Coding Agent
    "create_coding_agent",
    "run_coding_workflow",
    "run_full_pipeline_with_coding",
    "CodingResult",
    # TDD Pipeline
    "run_tdd_pipeline",
    "TDDResult",
]
