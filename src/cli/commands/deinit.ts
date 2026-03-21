import { existsSync } from "node:fs";
import { access, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import {
  buildManagedFileContent,
  CACHE_FILE,
  MANAGED_FILES,
  type ProjectSetupCache,
  RELEASE_TOOLS_DIR,
} from "@/cli/commands/init.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import { loadConfig } from "@/cli/config.ts";

interface DeinitOptions {
  cwd: string;
  log?: (message: string) => void;
  confirm?: (message: string) => Promise<boolean>;
  loadConfig?: (cwd: string) => Promise<ReleaseToolsConfig>;
  exec?: (command: string[]) => Promise<void>;
}

async function promptConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function defaultExec(cwd: string, command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
}

async function teardownProject(options: {
  cwd: string;
  log: (message: string) => void;
  exec: (command: string[]) => Promise<void>;
}): Promise<void> {
  const { cwd, log, exec } = options;
  const cachePath = join(cwd, CACHE_FILE);

  if (!existsSync(cachePath)) {
    log("⏭️  Skipped project setup restoration (no cache file)");
    return;
  }

  const cache: ProjectSetupCache = JSON.parse(await readFile(cachePath, "utf-8"));

  // Restore package.json
  const pkgPath = join(cwd, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

  for (const [key, original] of Object.entries(cache.scripts)) {
    if (original === null) {
      delete pkg.scripts?.[key];
    } else {
      pkg.scripts ??= {};
      pkg.scripts[key] = original;
    }
  }

  if (cache.lintStaged === null) {
    delete pkg["lint-staged"];
  } else {
    pkg["lint-staged"] = cache.lintStaged;
  }

  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log("✓ Restored package.json");

  // Restore tsconfig.json
  if (cache.tsconfig !== null) {
    const tsconfigPath = join(cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));

      if (cache.tsconfig.baseUrl === null) {
        delete tsconfig.compilerOptions?.baseUrl;
      } else {
        tsconfig.compilerOptions ??= {};
        tsconfig.compilerOptions.baseUrl = cache.tsconfig.baseUrl;
      }

      if (cache.tsconfig.paths === null) {
        delete tsconfig.compilerOptions?.paths;
      } else {
        tsconfig.compilerOptions ??= {};
        tsconfig.compilerOptions.paths = cache.tsconfig.paths;
      }

      await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
      log("✓ Restored tsconfig.json");
    } else {
      log("⚠️  Skipped tsconfig.json restoration (file not found)");
    }
  }

  // Uninstall deps
  if (cache.installedDeps.length > 0) {
    await exec(["bun", "remove", ...cache.installedDeps]);
    log(`✓ Uninstalled dev dependencies: ${cache.installedDeps.join(", ")}`);
  }

  // Delete cache file
  await unlink(cachePath);
  log(`✓ Removed ${CACHE_FILE}`);
}

export async function run(options: DeinitOptions): Promise<void> {
  const {
    cwd,
    log = console.log,
    confirm = promptConfirm,
    loadConfig: loadCfg = loadConfig,
  } = options;
  const exec = options.exec ?? ((cmd: string[]) => defaultExec(cwd, cmd));

  let expectedContent: Record<string, string> | null = null;
  try {
    const config = await loadCfg(cwd);
    expectedContent = buildManagedFileContent(config);
  } catch {
    // Config can't load — treat all files as modified
  }

  for (const relativePath of MANAGED_FILES) {
    const fullPath = join(cwd, relativePath);
    const name = basename(relativePath);

    try {
      await access(fullPath);
    } catch {
      log(`⏭️  Skipped ${name} (not found)`);
      continue;
    }

    const isModified = await checkModified(fullPath, relativePath, expectedContent);

    if (isModified) {
      const shouldRemove = await confirm(`${name} has been modified. Remove?`);
      if (!shouldRemove) {
        log(`⏭️  Skipped ${name} (kept)`);
        continue;
      }
    }

    await unlink(fullPath);
    log(`✓ Removed ${name}`);
  }

  // Clean up empty directories bottom-up
  const workflowsDir = join(cwd, ".github/workflows");
  if (await isDirectoryEmpty(workflowsDir)) {
    await rm(workflowsDir, { recursive: true });
  }
  const githubDir = join(cwd, ".github");
  if (await isDirectoryEmpty(githubDir)) {
    await rm(githubDir, { recursive: true });
  }

  await teardownProject({ cwd, log, exec });

  // Clean up .release-tools/ directory if empty
  const releaseToolsDir = join(cwd, RELEASE_TOOLS_DIR);
  if (await isDirectoryEmpty(releaseToolsDir)) {
    await rm(releaseToolsDir, { recursive: true });
  }
}

async function checkModified(
  fullPath: string,
  relativePath: string,
  expectedContent: Record<string, string> | null
): Promise<boolean> {
  if (!expectedContent) return true;

  const expected = expectedContent[relativePath];
  if (!expected) return true;

  const actual = await readFile(fullPath, "utf-8");
  return actual !== expected;
}
