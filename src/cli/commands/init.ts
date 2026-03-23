import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import {
  generateCiWorkflow,
  generateConfigTemplate,
  generateLintWorkflow,
  generatePublishWorkflow,
} from "@/cli/templates/workflows.ts";

export const RELEASE_TOOLS_DIR = ".release-tools";
export const CACHE_FILE = ".release-tools/cache.json";

export const MANAGED_SCRIPTS: Record<string, string> = {
  typecheck: "tsc --noEmit",
  knip: "knip-bun",
  lint: "biome check --write .",
  "lint:ci": "biome ci .",
  check: "bun run typecheck && bun run knip && bun run lint && AGENT=1 bun test --coverage",
  "check:ci":
    "bun run typecheck && bun run knip && bun run lint:ci && AGENT=1 bun test --coverage --coverage-reporter=lcov",
  prepare: "husky",
};

export const MANAGED_LINT_STAGED: Record<string, string[]> = {
  "*": ["biome check --write --no-errors-on-unmatched"],
};

export const MANAGED_TSCONFIG = {
  baseUrl: ".",
  paths: { "@/*": ["src/*"] },
} as const;

export const MANAGED_DEPS = ["husky", "lint-staged", "knip", "@biomejs/biome"] as const;

export interface ProjectSetupCache {
  scripts: Record<string, string | null>;
  lintStaged: Record<string, string[]> | null;
  tsconfig: string | null;
  installedDeps: string[];
}

export const MANAGED_FILES = [
  ".release-tools/config.ts",
  ".github/workflows/publish.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/lint-github-action-workflows.yml",
] as const;

export function buildManagedFileContent(
  config: ReleaseToolsConfig
): Record<(typeof MANAGED_FILES)[number], string> {
  return {
    ".release-tools/config.ts": generateConfigTemplate(config),
    ".github/workflows/publish.yml": generatePublishWorkflow(config),
    ".github/workflows/ci.yml": generateCiWorkflow(),
    ".github/workflows/lint-github-action-workflows.yml": generateLintWorkflow(),
  };
}

interface InitOptions {
  cwd: string;
  packageName: string;
  repo: string;
  excludedAuthors: string[];
  force?: boolean;
  homebrew?: ReleaseToolsConfig["homebrew"];
  log?: (message: string) => void;
  exec?: (command: string[]) => Promise<void>;
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
  const read = deps.readFile ?? ((path: string) => readFile(path, "utf-8"));
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
    packageJson = await read(join(deps.cwd, "package.json"));
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

async function defaultExec(cwd: string, command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function setupProject(options: {
  cwd: string;
  log: (message: string) => void;
  exec: (command: string[]) => Promise<void>;
}): Promise<void> {
  const { cwd, log, exec } = options;
  const cachePath = join(cwd, CACHE_FILE);
  const pkgPath = join(cwd, "package.json");

  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

  if (!existsSync(cachePath)) {
    const cache: ProjectSetupCache = {
      scripts: {},
      lintStaged: pkg["lint-staged"] ?? null,
      tsconfig: null,
      installedDeps: [],
    };

    for (const key of Object.keys(MANAGED_SCRIPTS)) {
      cache.scripts[key] = pkg.scripts?.[key] ?? null;
    }

    const tsconfigPath = join(cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      cache.tsconfig = await readFile(tsconfigPath, "utf-8");
    }

    const existingDevDeps = pkg.devDependencies ?? {};
    cache.installedDeps = MANAGED_DEPS.filter((dep) => !(dep in existingDevDeps));

    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    log(`✓ Created ${CACHE_FILE}`);
  } else {
    log(`⏭️  Skipped ${CACHE_FILE} (already exists)`);
  }

  const cache: ProjectSetupCache = JSON.parse(await readFile(cachePath, "utf-8"));

  pkg.scripts = { ...pkg.scripts, ...MANAGED_SCRIPTS };
  pkg["lint-staged"] = MANAGED_LINT_STAGED;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log("✓ Updated package.json (scripts, lint-staged)");

  const tsconfigPath = join(cwd, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));
    tsconfig.compilerOptions = {
      ...tsconfig.compilerOptions,
      baseUrl: MANAGED_TSCONFIG.baseUrl,
      paths: MANAGED_TSCONFIG.paths,
    };
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
    log("✓ Updated tsconfig.json (baseUrl, paths)");
  } else {
    log("⚠️  Skipped tsconfig.json (not found)");
  }

  if (cache.installedDeps.length > 0) {
    await exec(["bun", "install", "-d", ...cache.installedDeps]);
    log(`✓ Installed dev dependencies: ${cache.installedDeps.join(", ")}`);
  } else {
    log("⏭️  Skipped dependency installation (all present)");
  }
}

export async function run(options: InitOptions): Promise<void> {
  const {
    cwd,
    packageName,
    repo,
    excludedAuthors,
    force = false,
    homebrew,
    log = console.log,
  } = options;
  const exec = options.exec ?? ((cmd: string[]) => defaultExec(cwd, cmd));

  const config: ReleaseToolsConfig = {
    packageName,
    repo,
    excludedAuthors,
    ...(homebrew && { homebrew }),
  };

  const contentByPath = buildManagedFileContent(config);

  const files = MANAGED_FILES.map((relativePath) => ({
    path: join(cwd, relativePath),
    name: basename(relativePath),
    content: contentByPath[relativePath],
  }));

  await mkdir(join(cwd, RELEASE_TOOLS_DIR), { recursive: true });
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

  await setupProject({ cwd, log, exec });
}
