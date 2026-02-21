# ToyShop

Low-supervision software factory — OpenClaw Extension for automated software development with OpenSpec contracts.

## Overview

ToyShop is an OpenClaw extension that provides a complete software development pipeline:

```
User Request → Requirement Clarification → Architecture Design → TDD Code Generation → Verification
```

### Key Features

- **OpenSpec Integration**: Generate and parse OpenSpec documents (proposal.md, design.md, tasks.md, spec.md)
- **Multi-Stage Workflow**: Requirement clarification → Architecture design → TDD pipeline
- **TDD Pipeline**: Signature extraction → Test generation → Code generation → Whitebox/Blackbox verification
- **Debug Subsystem**: Probe, hypothesis, fault localization, test combination, expected comparison, rollback
- **PM System**: File-based project management with step-by-step CLI
- **Pseudo-Bootstrap Development**: Claude as UX agent supervising OpenHands code generation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ToyShop Extension                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: PM System                                             │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ PM CLI       │  │ Batch        │                             │
│  │ (step-by-step│  │ Orchestrator │                             │
│  └──────────────┘  └──────────────┘                             │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: TDD Pipeline                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ Signature  │ │ Test       │ │ Code       │ │ Verify     │   │
│  │ Extraction │→│ Generation │→│ Generation │→│ (WB + BB)  │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Debug: probe | hypothesis | fault_localize | rollback      │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Workflows                                             │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ Requirement  │→ │ Architecture │                             │
│  │ Clarification│  │ Design       │                             │
│  └──────────────┘  └──────────────┘                             │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Core                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ OpenSpec   │ │ OpenHands  │ │ LLM        │ │ OpenSpec   │   │
│  │ Bridge     │ │ Agents     │ │ Adapter    │ │ Types      │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Infrastructure                                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                   │
│  │ OpenSpec   │ │ OpenHands  │ │ LangGraph  │                   │
│  │ (format)   │ │ SDK        │ │ (workflow) │                   │
│  └────────────┘ └────────────┘ └────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### PM CLI (Step-by-Step)

```bash
# Step 1: Create batch with requirements
python3 -m toyshop.pm_cli create --name my-project --input "Build a REST API with CRUD operations"

# Step 2: Generate openspec docs (proposal, design, tasks, spec)
python3 -m toyshop.pm_cli spec --batch <batch_dir>
# ← Review openspec/ docs here

# Step 3: Parse tasks (display only)
python3 -m toyshop.pm_cli tasks --batch <batch_dir>

# Step 4: Run TDD pipeline
python3 -m toyshop.pm_cli tdd --batch <batch_dir>
# ← Review generated code here

# Check status anytime
python3 -m toyshop.pm_cli status --batch <batch_dir>
```

### Full Auto Pipeline

```bash
python3 -m toyshop.pm_cli run --name my-project --input "Build a REST API with CRUD operations"
```

### Output Structure

```
<batch_dir>/
├── requirements.md          # Original user input
├── progress.json            # Batch status tracking
├── openspec/
│   ├── proposal.md          # Requirements proposal
│   ├── design.md            # Technical design with interfaces
│   ├── tasks.md             # Task breakdown
│   └── spec.md              # Behavioral specs
├── workspace/
│   ├── openspec/            # Copy for TDD pipeline
│   ├── <project>/           # Generated source code
│   └── tests/               # Generated tests
├── tasks/                   # Per-task tracking (display)
├── agent_logs/              # Pipeline phase logs
└── result.json              # TDD result summary
```

## Development

### Prerequisites

- Python 3.11+
- OpenHands SDK (`openhands-sdk`)

### Install

```bash
cd extensions/toyshop/python
pip install -e .
```

### Test

```bash
cd extensions/toyshop/python
python3 -m pytest tests/ -v
```

## Roadmap

### MVP — Completed

- [x] OpenSpec document generation
- [x] Requirement clarification workflow
- [x] Architecture design workflow
- [x] OpenHands SDK integration
- [x] TDD pipeline (signature → test → code → verify)
- [x] Debug subsystem (probe, hypothesis, fault localize, rollback)
- [x] PM system with file-based tracking
- [x] Step-by-step CLI for supervised development
- [x] End-to-end pipeline (472 tests passing on mdtable benchmark)

### Next

- [ ] Change pipeline (brownfield/incremental changes to existing code)
- [ ] Maintenance pipeline
- [ ] Iteration pipeline

### Future

- [ ] Multi-developer support
- [ ] CI/CD integration
- [ ] Message platform triggers (Slack, Feishu, etc.)

## License

MIT
