import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseToolsConfig } from "../config.ts";
import {
  generateCiWorkflow,
  generateConfigTemplate,
  generateLintWorkflow,
  generatePublishWorkflow,
} from "../templates/workflows.ts";

interface InitOptions {
  cwd: string;
  packageName: string;
  repo: string;
  force?: boolean;
  homebrew?: ReleaseToolsConfig["homebrew"];
  log?: (message: string) => void;
}

export async function run(options: InitOptions): Promise<void> {
  const { cwd, packageName, repo, force = false, homebrew, log = console.log } = options;

  const config: ReleaseToolsConfig = {
    packageName,
    repo,
    ...(homebrew && { homebrew }),
  };

  const files = [
    {
      path: join(cwd, "release-tools.config.ts"),
      name: "release-tools.config.ts",
      content: generateConfigTemplate({ packageName, repo, homebrew }),
    },
    {
      path: join(cwd, ".github/workflows/publish.yml"),
      name: "publish.yml",
      content: generatePublishWorkflow(config),
    },
    {
      path: join(cwd, ".github/workflows/ci.yml"),
      name: "ci.yml",
      content: generateCiWorkflow(),
    },
    {
      path: join(cwd, ".github/workflows/lint-github-action-workflows.yml"),
      name: "lint-github-action-workflows.yml",
      content: generateLintWorkflow(),
    },
  ];

  await mkdir(join(cwd, ".github/workflows"), { recursive: true });

  for (const file of files) {
    const existed = existsSync(file.path);
    if (existed && !force) {
      log(`⏭️  Skipped ${file.name} (already exists, use --force to overwrite)`);
      continue;
    }

    await writeFile(file.path, file.content);
    log(`✓ ${existed ? "Updated" : "Created"} ${file.name}`);
  }
}
