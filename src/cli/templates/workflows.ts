import type { ReleaseToolsConfig } from "@/cli/config.ts";

export function generateConfigTemplate(
  config: Pick<ReleaseToolsConfig, "packageName" | "repo" | "excludedAuthors" | "homebrew">
): string {
  const excludedAuthorsBlock = `\n  excludedAuthors: [${config.excludedAuthors.map((a) => `'${a}'`).join(", ")}],`;

  const homebrewBlock = config.homebrew
    ? `
  homebrew: {
    tapRepo: '${config.homebrew.tapRepo}',
    formulaPath: '${config.homebrew.formulaPath}',
    sourceRepo: '${config.homebrew.sourceRepo}',
  },`
    : "";

  return `import { defineConfig } from "release-tools/config";

export default defineConfig({
  packageName: '${config.packageName}',
  repo: '${config.repo}',${excludedAuthorsBlock}${homebrewBlock}
});
`;
}

// biome-ignore lint/style/useTemplate: Cannot use template literal due to nested template variables in YAML
const gh = (expr: string) => "${{ " + expr + " }}";
const GH_WORKFLOW = gh("github.workflow");
const GH_REF = gh("github.ref");
const INPUTS_BUMP = gh("inputs.bump");
const INPUTS_VERSION = gh("inputs.version");
const SECRETS_GITHUB_TOKEN = gh("secrets.GITHUB_TOKEN");
const SECRETS_HOMEBREW_TOKEN = gh("secrets.HOMEBREW_TAP_TOKEN");
const STEPS_VERSION_OUTPUT = gh("steps.version.outputs.version");
const GITHUB_SHA = gh("github.sha");
const STEPS_NOTES = gh("steps.notes.outputs.notes");
const RUN_NAME = gh("format('release {0}', inputs.bump)");

export function generatePublishWorkflow(config: ReleaseToolsConfig): string {
  const homebrewStep = config.homebrew
    ? `
      - name: Get published version
        id: version
        run: echo "version=$(jq -r .version package.json)" >> "$GITHUB_OUTPUT"

      - name: Update Homebrew tap
        run: bunx release-tools homebrew "${STEPS_VERSION_OUTPUT}"
        env:
          GH_TOKEN: ${SECRETS_HOMEBREW_TOKEN}`
    : "";

  return `name: Publish
run-name: "${RUN_NAME}"

on:
  workflow_dispatch:
    inputs:
      bump:
        description: "Bump major, minor, or patch"
        required: true
        type: choice
        options:
          - major
          - minor
          - patch
      version:
        description: "Override version (optional)"
        required: false
        type: string

concurrency: ${GH_WORKFLOW}-${GH_REF}

permissions:
  contents: write
  id-token: write

jobs:
  full-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run project checks
        run: bun run check:ci

  publish:
    runs-on: ubuntu-latest
    needs: [full-check]
    if: github.repository == '${config.repo}'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - run: git fetch --force --tags

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: "24"

      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest

      - name: Configure npm registry
        run: npm config set registry https://registry.npmjs.org

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Publish
        run: bunx release-tools publish
        env:
          BUMP: ${INPUTS_BUMP}
          VERSION: ${INPUTS_VERSION}
          CI: true
          HUSKY: "0"
          GITHUB_TOKEN: ${SECRETS_GITHUB_TOKEN}
          NPM_CONFIG_PROVENANCE: true${homebrewStep}

      - name: Delete draft release
        run: gh release delete next --yes 2>/dev/null || echo "No draft release to delete"
        env:
          GH_TOKEN: ${SECRETS_GITHUB_TOKEN}
`;
}

export function generateCiWorkflow(): string {
  return `name: CI

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - ".github/workflows/**"
      - "src/**"
      - "tests/**"
      - "package.json"
      - "bun.lock"
      - "tsconfig.json"
      - "biome.json"
  pull_request:
    branches: [main]
    paths:
      - ".github/workflows/**"
      - "src/**"
      - "tests/**"
      - "package.json"
      - "bun.lock"
      - "tsconfig.json"
      - "biome.json"

concurrency:
  group: ${GH_WORKFLOW}-${GH_REF}
  cancel-in-progress: true

jobs:
  full-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run project checks
        run: bun run check:ci

  draft-release:
    runs-on: ubuntu-latest
    if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - run: git fetch --force --tags

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Generate release notes
        id: notes
        run: |
          NOTES=\`bunx release-tools changelog\`
          {
            echo "notes<<EOF"
            echo "$NOTES"
            echo "EOF"
          } >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: ${SECRETS_GITHUB_TOKEN}

      - name: Create or update draft release
        env:
          GH_TOKEN: ${SECRETS_GITHUB_TOKEN}
        run: |
          EXISTING_DRAFT=\`gh release list --json tagName,isDraft --jq '.[] | select(.isDraft == true and .tagName == "next") | .tagName'\`

          if [ -n "$EXISTING_DRAFT" ]; then
            echo "Updating existing draft release..."
            gh release edit next \\
              --title "Upcoming Changes 🛡️" \\
              --notes-file - \\
              --draft <<'NOTES_EOF'
          ${STEPS_NOTES}
          NOTES_EOF
          else
            echo "Creating new draft release..."
            gh release create next \\
              --title "Upcoming Changes 🛡️" \\
              --notes-file - \\
              --draft \\
              --target ${GITHUB_SHA} <<'NOTES_EOF'
          ${STEPS_NOTES}
          NOTES_EOF
          fi
`;
}

export function generateLintWorkflow(): string {
  return `name: Lint GitHub Actions Workflows

on:
  push:
    paths:
      - '.github/workflows/**'
  pull_request:
    paths:
      - '.github/workflows/**'

jobs:
  actionlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Install actionlint
        run: |
          bash <(curl -sSL https://raw.githubusercontent.com/rhysd/actionlint/v1.7.10/scripts/download-actionlint.bash)

      - name: Run actionlint
        run: ./actionlint -color -shellcheck=""
`;
}
