# ToyShop

Low-supervision software factory - OpenClaw Extension for automated software development with OpenSpec contracts.

## Overview

ToyShop is an OpenClaw extension that provides a complete software development pipeline:

```
User Request → Requirement Clarification → Architecture Design → Code Generation → Architecture Persistence
```

### Key Features

- **OpenSpec Integration**: Generate and parse OpenSpec documents (proposal.md, design.md, tasks.md, spec.md)
- **Multi-Stage Workflow**: Requirement clarification → Architecture design → Coding → Persistence
- **Architecture Database**: SQLite-based persistence for architecture snapshots
- **LangGraph Workflows**: Type-safe workflow orchestration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ToyShop Extension                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: Pipelines                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Development  │  │ Maintenance  │  │ Iteration    │          │
│  │ Pipeline     │  │ Pipeline     │  │ Pipeline     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Workflows                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Requirement  │→ │ Architecture │→ │ Coding       │          │
│  │ Clarification│  │ Design       │  │ & Test       │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Core                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ OpenSpec   │ │ OpenHands  │ │ Memory     │ │ Knowledge  │   │
│  │ Generator  │ │ Adapter    │ │ Manager    │ │ Manager    │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Infrastructure                                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ OpenSpec   │ │ OpenHands  │ │ SQLite     │ │ LangGraph  │   │
│  │ (format)   │ │ SDK        │ │ (persist)  │ │ (workflow) │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js >= 20.19.0
- OpenClaw workspace

### Install in OpenClaw

```bash
cd openclaw/extensions
git clone <toyshop-repo> toyshop
cd ../..
pnpm install
```

## Usage

### Basic Usage

```typescript
import { runDevelopmentPipeline } from "@openclaw/toyshop";

const result = await runDevelopmentPipeline({
  userInput: "Create a TODO CLI tool with add, list, done, and delete commands",
  projectName: "todo-cli",
  workspaceDir: "./projects/todo-cli",
});

console.log(result.currentStage); // "done"
console.log(result.proposalContent); // OpenSpec proposal.md content
```

### Output Structure

After running the pipeline, the workspace will contain:

```
my-project/
├── openspec/
│   ├── proposal.md      # Requirements proposal
│   ├── design.md        # Technical design
│   ├── tasks.md         # Task breakdown
│   └── specs/
│       └── main.md      # Behavioral specs
├── src/
│   └── index.ts         # Generated code
└── .toyshop/
    └── architecture.db  # Architecture database
```

## Configuration

Configure via `openclaw.plugin.json`:

```json
{
  "maxRetries": 3,
  "retryDelayBase": 1000,
  "defaultTimeout": 600000,
  "enableCheckpoint": true,
  "checkpointPath": ".toyshop/checkpoints",
  "architectureDbPath": ".toyshop/architecture.db",
  "openspecDir": "openspec",
  "sourceDir": "src"
}
```

## Development

### Build

```bash
cd extensions/toyshop
pnpm build
```

### Test

```bash
pnpm test
```

### Type Check

```bash
pnpm typecheck
```

## Roadmap

### MVP (Current)

- [x] OpenSpec document generation
- [x] SQLite architecture persistence
- [x] Requirement clarification workflow
- [ ] Architecture design workflow (in progress)
- [ ] OpenHands SDK integration
- [ ] End-to-end pipeline

### Post-MVP

- [ ] Maintenance pipeline
- [ ] Iteration pipeline
- [ ] Multi-developer support
- [ ] CI/CD integration
- [ ] Message platform triggers (Slack, Feishu, etc.)

## License

MIT
