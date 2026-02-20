# Quality Standards

All generated artifacts must meet the following quality standards:

## Code Quality

- Follow project coding conventions and style guides
- No unused imports, variables, or dead code
- Proper error handling with meaningful messages
- Functions should have single responsibility
- Maximum cyclomatic complexity: 15

## Architecture Quality

- Clear separation of concerns
- Loose coupling between modules
- High cohesion within modules
- Dependencies flow inward (dependency inversion)
- No circular dependencies

## Documentation Quality

- Public APIs must have JSDoc/docstring comments
- Complex logic must have inline explanations
- README must describe setup, usage, and architecture

## Testing Quality

- Unit tests for all public functions
- Edge cases and error paths covered
- Test names describe expected behavior
- No flaky or order-dependent tests
