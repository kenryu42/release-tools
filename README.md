# release-tools

Shared release automation CLI. Provides publish orchestration, changelog generation, and Homebrew tap updates. Consuming projects install it as a git dependency and run `release-tools init` to scaffold config and CI workflows.

## Installation

Install as a git dependency in your project:

```bash
bun add -d github:kenryu42/release-tools
```

## Quick start

Run `init` in your project to scaffold config, workflows, and dev tooling:

```bash
bunx release-tools init
```

This auto-detects the package name from `package.json` and the repo from the git remote origin. Use `--force` to overwrite existing files.

### What init creates

- `.release-tools/config.ts` -- project-specific settings
- `.github/workflows/publish.yml` -- manual-trigger publish pipeline
- `.github/workflows/ci.yml` -- PR/push quality gate
- `.github/workflows/lint-github-action-workflows.yml` -- actionlint validation

### What init manages

Init also configures your project's dev tooling, storing original state in `.release-tools/cache.json` so `deinit` can restore it:

- **package.json scripts** -- adds `typecheck`, `knip`, `lint`, `lint:ci`, `check`, `prepare`
- **lint-staged config** -- adds Biome check for all files
- **tsconfig.json** -- adds `baseUrl` and `@/*` path alias (if tsconfig exists)
- **Dev dependencies** -- installs `husky`, `lint-staged`, `knip`, `@biomejs/biome`

## Configuration

Define your project config in `.release-tools/config.ts`:

```ts
import { defineConfig } from "release-tools/config";

export default defineConfig({
  packageName: "my-package",
  repo: "owner/repo",
  releaseFiles: ["package.json"],       // files allowed to change during publish
  build: "bun run build",               // build command (optional)
  excludedAuthors: ["github-actions"],   // bots to exclude from changelog
  publishCommand: ["npm", "publish", "--access", "public", "--provenance"], // custom publish command (optional)
  homebrew: {                            // omit if no Homebrew tap
    tapRepo: "owner/homebrew-tap",
    formulaPath: "Formula/my-package.rb",
    sourceRepo: "owner/source-repo",
  },
});
```

## CLI

```
release-tools <command>
```

| Command     | Description |
|-------------|-------------|
| `init`      | Scaffold config, workflows, and dev tooling (auto-detects package name and repo) |
| `deinit`    | Remove all files and config created by init, restoring original state |
| `publish`   | Version bump, build, npm publish, git tag, GitHub release |
| `changelog` | Print release notes since the last published tag |
| `homebrew`  | Update a Homebrew tap formula with a new version and SHA256 |

### init

Scaffolds a consuming project with config, CI workflows, and dev tooling. See [Quick start](#quick-start) above.

```bash
release-tools init          # scaffold (skips existing files)
release-tools init --force  # overwrite existing files
```

### deinit

Removes all files created by `init` and restores original `package.json`, `tsconfig.json`, and dependency state from the cache. Prompts for confirmation if any managed files were modified.

```bash
release-tools deinit
```

### publish

Runs the full publish pipeline: preflight checks, version bump, build, npm publish, git tag/push, and GitHub release creation.

```bash
BUMP=patch release-tools publish           # bump patch version
BUMP=minor release-tools publish --dry-run # preview without side effects
release-tools publish --recover            # check for partial publish state
release-tools publish --recover --execute  # retry from where it left off
```

Requires `CI=true` for real publishes. Accepts `BUMP` (major/minor/patch) and optional `VERSION` environment variables.

### changelog

Generates release notes from git history since the last published GitHub release.

```bash
release-tools changelog
```

Parses commits matching `feat|fix` patterns, fetches contributor info via `gh api`, and prints formatted markdown.

### homebrew

Updates a Homebrew tap formula with the new version's tarball URL and SHA256.

```bash
release-tools homebrew 1.2.3
```

Requires `homebrew` to be configured in `.release-tools/config.ts`.

## Development

```bash
bun install                      # install deps
bun test                         # run all tests
bun test tests/publish.test.ts   # run a single test file
bun run typecheck                # tsc --noEmit
bun run knip                     # dead code detection
bun run lint                     # biome check --write
bun run check                    # full gate: typecheck + knip + lint + test
```

### Code style

Biome with 2-space indent, 100-char line width, double quotes, ES5 trailing commas.

### Testing conventions

- All external commands (git, npm, gh) are mocked via `createMockRunner` -- tests never hit real APIs.
- Tests must produce zero console output on success.

## License

MIT
