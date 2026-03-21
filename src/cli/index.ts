#!/usr/bin/env bun

const command = process.argv[2];

const commands: Record<string, () => Promise<void>> = {
  init: async () => {
    const { detectProjectInfo, run } = await import("./commands/init.ts");
    const args = process.argv.slice(3);
    const force = args.includes("--force");
    const cwd = process.cwd();
    const { packageName, repo } = await detectProjectInfo({ cwd });
    await run({ cwd, packageName, repo, force });
  },
  deinit: () => import("./commands/deinit.ts").then((m) => m.run({ cwd: process.cwd() })),
  publish: () => import("./commands/publish.ts").then((m) => m.run()),
  changelog: () => import("./commands/changelog.ts").then((m) => m.run()),
  homebrew: () => import("./commands/homebrew.ts").then((m) => m.run()),
  help: async () => {
    printUsage();
    process.exit(0);
  },
};

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command.startsWith("-")) {
    console.error(`Unknown option: ${command}`);
    printUsage();
    process.exit(1);
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
  deinit            Remove files created by init
  publish           Publish a new version to npm and create GitHub release
  changelog         Generate and print changelog
  homebrew          Update Homebrew tap formula
  help              Show this help message

Examples:
  release-tools init
  release-tools deinit
  release-tools publish --dry-run
  release-tools changelog
  release-tools homebrew 1.2.3
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
