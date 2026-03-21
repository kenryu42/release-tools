import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as deinit } from "@/cli/commands/deinit.ts";
import { run as init, MANAGED_FILES } from "@/cli/commands/init.ts";

const noop = () => {};
const PKG = { packageName: "test-pkg", repo: "owner/test-pkg" };
const fakeLoadConfig = async () => PKG;

async function scaffold(projectDir: string) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: PKG.packageName }));
  await init({ cwd: projectDir, ...PKG, log: noop });
}

describe("deinit command", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-tools-deinit-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("removes all unmodified files created by init", async () => {
    const dir = join(tempDir, "all-unmodified");
    await scaffold(dir);

    for (const f of MANAGED_FILES) {
      expect(existsSync(join(dir, f))).toBe(true);
    }

    await deinit({ cwd: dir, log: noop, confirm: async () => true, loadConfig: fakeLoadConfig });

    for (const f of MANAGED_FILES) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
  });

  test("skips missing files gracefully", async () => {
    const dir = join(tempDir, "empty-dir");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: PKG.packageName }));

    // Should not throw
    await deinit({ cwd: dir, log: noop, confirm: async () => true, loadConfig: fakeLoadConfig });
  });

  test("cleans up empty .github directories", async () => {
    const dir = join(tempDir, "cleanup-dirs");
    await scaffold(dir);

    await deinit({ cwd: dir, log: noop, confirm: async () => true, loadConfig: fakeLoadConfig });

    expect(existsSync(join(dir, ".github/workflows"))).toBe(false);
    expect(existsSync(join(dir, ".github"))).toBe(false);
  });

  test("preserves non-managed files in .github/workflows", async () => {
    const dir = join(tempDir, "preserve-custom");
    await scaffold(dir);

    const customWorkflow = join(dir, ".github/workflows/custom.yml");
    await writeFile(customWorkflow, "name: Custom");

    await deinit({ cwd: dir, log: noop, confirm: async () => true, loadConfig: fakeLoadConfig });

    expect(existsSync(customWorkflow)).toBe(true);
    expect(existsSync(join(dir, ".github/workflows"))).toBe(true);
  });

  test("prompts for modified files and removes when confirmed", async () => {
    const dir = join(tempDir, "modified-confirm");
    await scaffold(dir);

    const ciPath = join(dir, ".github/workflows/ci.yml");
    await writeFile(ciPath, "name: Modified CI");

    let prompted = false;
    await deinit({
      cwd: dir,
      log: noop,
      loadConfig: fakeLoadConfig,
      confirm: async () => {
        prompted = true;
        return true;
      },
    });

    expect(prompted).toBe(true);
    expect(existsSync(ciPath)).toBe(false);
  });

  test("skips modified files when user declines", async () => {
    const dir = join(tempDir, "modified-decline");
    await scaffold(dir);

    const ciPath = join(dir, ".github/workflows/ci.yml");
    await writeFile(ciPath, "name: Modified CI");

    await deinit({
      cwd: dir,
      log: noop,
      loadConfig: fakeLoadConfig,
      confirm: async () => false,
    });

    expect(existsSync(ciPath)).toBe(true);
    // Unmodified files should still be removed
    expect(existsSync(join(dir, ".github/workflows/publish.yml"))).toBe(false);
  });

  test("treats all files as modified when config cannot load", async () => {
    const dir = join(tempDir, "no-config");
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, ".github/workflows/ci.yml"), "name: CI");
    await writeFile(join(dir, ".github/workflows/publish.yml"), "name: Publish");

    const confirmCalls: string[] = [];
    await deinit({
      cwd: dir,
      log: noop,
      confirm: async (msg) => {
        confirmCalls.push(msg);
        return true;
      },
    });

    expect(confirmCalls.length).toBe(2);
    expect(existsSync(join(dir, ".github/workflows/ci.yml"))).toBe(false);
    expect(existsSync(join(dir, ".github/workflows/publish.yml"))).toBe(false);
  });

  test("logs removed and skipped files", async () => {
    const dir = join(tempDir, "log-output");
    await scaffold(dir);

    const logs: string[] = [];
    await deinit({
      cwd: dir,
      log: (msg) => logs.push(msg),
      confirm: async () => true,
      loadConfig: fakeLoadConfig,
    });

    const removed = logs.filter((l) => l.includes("Removed"));
    const skipped = logs.filter((l) => l.includes("Skipped"));
    expect(removed.length).toBe(4);
    expect(skipped.length).toBe(0);
  });
});
