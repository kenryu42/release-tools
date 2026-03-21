import { access, readdir, readFile, rm, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { buildManagedFileContent, MANAGED_FILES } from "@/cli/commands/init.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import { loadConfig } from "@/cli/config.ts";

interface DeinitOptions {
  cwd: string;
  log?: (message: string) => void;
  confirm?: (message: string) => Promise<boolean>;
  loadConfig?: (cwd: string) => Promise<ReleaseToolsConfig>;
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

export async function run(options: DeinitOptions): Promise<void> {
  const {
    cwd,
    log = console.log,
    confirm = promptConfirm,
    loadConfig: loadCfg = loadConfig,
  } = options;

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
