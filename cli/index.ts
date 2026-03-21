#!/usr/bin/env bun

const command = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  init: async () => {
    console.error("Error: init requires --package-name and --repo flags or interactive input");
    console.error("Usage: release-tools init --package-name <name> --repo <owner/repo>");
    process.exit(1);
  },
  publish: () => import("./commands/publish.ts").then((m) => m.run()),
  changelog: () => import("./commands/changelog.ts").then((m) => m.run()),
  homebrew: () => import("./commands/homebrew.ts").then((m) => m.run()),
};

async function main() {
  if (!command || command.startsWith("-")) {
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  await handler();
}

function printUsage() {
  console.log(`
release-tools - Release automation utilities

Usage:
  release-tools <command> [options]

Commands:
  init              Scaffold release-tools.config.ts and GitHub Actions workflows
  publish           Publish a new version to npm and create GitHub release
  changelog         Generate and print changelog
  homebrew          Update Homebrew tap formula

Examples:
  release-tools init
  release-tools publish --dry-run
  release-tools changelog
  release-tools homebrew 1.2.3
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
