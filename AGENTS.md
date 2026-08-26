# Agent Instructions

## Specification

All implementation work **must** conform to the design specification in [`docs/SPEC.md`](docs/SPEC.md). Read it in full before beginning any task. The spec is the source of truth for architecture, tool definitions, protocol details, error handling, and project structure.

## Commit Conventions

Use **subject-only conventional commits**. The entire commit message is a single line — no body, no footer.

Format: `<type>: <subject>`

Examples:
- `feat: add roku_send_keys tool handler`
- `fix: handle empty sgnodes tree response`
- `test: add integration tests for crash recovery`
- `refactor: extract digest auth into standalone module`
- `docs: update SPEC.md with timeout defaults`
- `chore: configure tsup build`

Allowed types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `perf`.

**Commit completed and validated work promptly.** Do not accumulate unrelated changes into a single commit. Each commit should represent a coherent, working unit of change that has been verified before committing.

## Testing Requirements

Every implementation task **must** include appropriate tests. Do not consider work complete until tests are written and passing.

### Unit Tests

Write unit tests for all modules, adapters, parsers, and library utilities. Use mocked network responses — unit tests must not require a Roku device. Refer to Section 11.1 of the spec for the required coverage areas per module.

### Integration Tests

Write integration tests that run against a **real Roku device**. These tests are gated behind the `ROKU_INTEGRATION_TEST=1` environment variable and must be skipped when it is not set. Refer to Section 11.2 of the spec for the required integration test scenarios.

Integration tests must:
- Use the real Roku protocols (HTTP, Telnet) against a physical device.
- Validate end-to-end behavior, not just mocked interactions.
- Clean up after themselves (e.g., uninstall sideloaded apps when done).
- Have reasonable timeouts appropriate for real hardware latency.
