import { existsSync } from "node:fs";
import { readFile as fsReadFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import {
  generateCiWorkflow,
  generateConfigTemplate,
  generateLintWorkflow,
  generatePublishWorkflow,
} from "@/cli/templates/workflows.ts";

export const MANAGED_FILES = [
  "release-tools.config.ts",
  ".github/workflows/publish.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/lint-github-action-workflows.yml",
] as const;

export function buildManagedFileContent(
  config: ReleaseToolsConfig
): Record<(typeof MANAGED_FILES)[number], string> {
  return {
    "release-tools.config.ts": generateConfigTemplate(config),
    ".github/workflows/publish.yml": generatePublishWorkflow(config),
    ".github/workflows/ci.yml": generateCiWorkflow(),
    ".github/workflows/lint-github-action-workflows.yml": generateLintWorkflow(),
  };
}

interface InitOptions {
  cwd: string;
  packageName: string;
  repo: string;
  force?: boolean;
  homebrew?: ReleaseToolsConfig["homebrew"];
  log?: (message: string) => void;
}

interface DetectDeps {
  cwd: string;
  readFile?: (path: string) => Promise<string>;
  gitRemoteUrl?: () => Promise<string>;
}

function parseRepo(remoteUrl: string): string {
  const sshMatch = remoteUrl.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];

  const httpsMatch = remoteUrl.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];

  throw new Error(`Could not parse repo from git remote URL: ${remoteUrl}`);
}

export async function detectProjectInfo(
  deps: DetectDeps
): Promise<{ packageName: string; repo: string }> {
  const readFile = deps.readFile ?? ((path: string) => fsReadFile(path, "utf-8"));
  const gitRemoteUrl =
    deps.gitRemoteUrl ??
    (async () => {
      const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
        cwd: deps.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) throw new Error("not a git repo or no remote");
      return (await new Response(proc.stdout).text()).trim();
    });

  let packageJson: string;
  try {
    packageJson = await readFile(join(deps.cwd, "package.json"));
  } catch {
    throw new Error("No package.json found in current directory.");
  }

  const parsed = JSON.parse(packageJson);
  if (!parsed.name) {
    throw new Error('package.json is missing a "name" field.');
  }

  let remoteUrl: string;
  try {
    remoteUrl = await gitRemoteUrl();
  } catch {
    throw new Error("Could not detect git remote. Is this a git repository with a remote?");
  }

  const repo = parseRepo(remoteUrl);

  return { packageName: parsed.name, repo };
}

export async function run(options: InitOptions): Promise<void> {
  const { cwd, packageName, repo, force = false, homebrew, log = console.log } = options;

  const config: ReleaseToolsConfig = {
    packageName,
    repo,
    ...(homebrew && { homebrew }),
  };

  const contentByPath = buildManagedFileContent(config);

  const files = MANAGED_FILES.map((relativePath) => ({
    path: join(cwd, relativePath),
    name: basename(relativePath),
    content: contentByPath[relativePath],
  }));

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
