# release-tools

Shared release automation toolkit. Provides publish orchestration, changelog generation, and Homebrew tap updates as a CLI.

## Setup

```bash
bun install
```

### Bootstrapping a consuming project

Run `init` in the target project to scaffold a config file and GitHub Actions workflows:

```bash
bunx release-tools init
```

The command auto-detects the package name from `package.json` and the repo from the git remote origin. Use `--force` to overwrite existing files.

This creates:

- `release-tools.config.ts` -- project-specific settings
- `.github/workflows/publish.yml` -- manual-trigger publish pipeline
- `.github/workflows/ci.yml` -- PR/push quality gate
- `.github/workflows/lint-github-action-workflows.yml` -- actionlint validation

## Configuration

Define your project config in `release-tools.config.ts`:

```ts
import { defineConfig } from "release-tools/config";

export default defineConfig({
  packageName: "my-package",
  repo: "owner/repo",
  releaseFiles: ["package.json"],       // files allowed to change during publish
  build: "bun run build",               // build command (optional)
  excludedAuthors: ["github-actions"],   // bots to exclude from changelog
  publishCommand: ["npm", "publish"],    // custom publish command (optional)
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
| `init`      | Scaffold config and CI workflows (auto-detects package name and repo) |
| `publish`   | Version bump, build, npm publish, git tag, GitHub release |
| `changelog` | Print release notes since the last published tag |
| `homebrew`  | Update a Homebrew tap formula with a new version and SHA256 |

### publish

Runs the full publish pipeline: preflight checks, version bump, build, npm publish, git tag/push, and GitHub release creation.

```bash
BUMP=patch release-tools publish           # bump patch version
BUMP=minor release-tools publish --dry-run # preview without side effects
release-tools publish --recover            # retry a failed publish from where it left off
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

Requires `homebrew` to be configured in `release-tools.config.ts`.

## Development

```bash
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
