# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory

Always run `bun run check` after making changes. No exceptions.

Tests must produce no console output on success. Inject a no-op `log` (or equivalent) to silence output from the code under test. Console output during a passing test run is treated as a bug.

## What This Is

Shared release automation toolkit for 420024-lab projects. Provides three core modules (publish, changelog, homebrew) as both a library (package exports) and a CLI (`release-tools`). Consuming projects add a `release-tools.config.ts` and get CI/publish workflows via `release-tools init`.

## Commands

```bash
bun install              # install deps
bun test                 # run all tests
bun test tests/publish.test.ts   # run a single test file
bun run typecheck        # tsc --noEmit
bun run knip             # dead code detection (knip-bun)
bun run lint             # biome check --write
bun run lint:ci          # biome ci (no auto-fix, for CI)
bun run check            # typecheck + knip + lint + test (full gate)
```

## Architecture

### Library modules (root-level `.ts` files)

- **`changelog.ts`** - Git log parsing, contributor fetching via `gh api`, release note formatting. All functions accept an optional `CommandRunner` for testability.
- **`publish.ts`** - Full publish orchestration: version bump, preflight checks, npm publish, git tag/push, GitHub release creation. Supports `--dry-run` and `--recover` modes. Requires `CI=true` for real publishes.
- **`homebrew.ts`** - Updates a Homebrew tap formula via GitHub API (fetches tarball SHA256, patches formula, pushes via `gh api`).
- **`testing.ts`** - `createMockRunner` factory: builds a `CommandRunner` that pattern-matches shell command strings against canned responses. Used by all test files.

### CLI layer (`cli/`)

- **`cli/index.ts`** - Entry point (`bin` in package.json). Dispatches `init`, `publish`, `changelog`, `homebrew` subcommands.
- **`cli/config.ts`** - `defineConfig()` / `loadConfig()` for `release-tools.config.ts` files in consuming projects.
- **`cli/commands/`** - Each command adapter loads config, converts `ReleaseToolsConfig` into the module-specific options type, then calls the library function.
- **`cli/templates/workflows.ts`** - Generates GitHub Actions YAML (publish, CI, actionlint) as template strings. Uses a `gh()` helper to emit `${{ }}` expressions.

### Reference workflows (`workflows/`)

Live workflow YAML files extracted from a consuming project (ralph-review). These serve as the source-of-truth that the template generators should reproduce.

### Test structure

Tests live in `tests/` mirroring the source layout (`tests/cli/` for CLI tests). All external commands are mocked via `createMockRunner` from `testing.ts` - tests never hit real git, npm, or GitHub APIs.

## Key Design Patterns

- **`CommandRunner` injection**: The `$` tagged template from Bun is the default shell runner. Every function that shells out accepts an optional `CommandRunner`, allowing tests to substitute `createMockRunner`. The runner uses tagged template literal syntax: `` runner`git log ...`.text() ``.
- **Config-driven CLI**: The CLI reads `release-tools.config.ts` (via dynamic `import()`) and adapts it to each module's options type. The `defineConfig()` export provides type safety for consuming projects.
- **Package exports**: Consuming projects can import individual modules (`release-tools/publish`, `release-tools/changelog`, etc.) for programmatic use, or use the CLI via `bunx release-tools`.

## Formatting

Biome with: 2-space indent, 100-char line width, double quotes, ES5 trailing commas. Run `bun run lint` to auto-fix.
