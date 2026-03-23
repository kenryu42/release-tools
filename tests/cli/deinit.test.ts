import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as deinit } from "@/cli/commands/deinit.ts";
import {
  CACHE_FILE,
  run as init,
  MANAGED_DEPS,
  MANAGED_FILES,
  MANAGED_SCRIPTS,
} from "@/cli/commands/init.ts";

const noop = () => {};
const noopExec = async () => {};
const PKG = { packageName: "test-pkg", repo: "owner/test-pkg", excludedAuthors: ["owner"] };
const fakeLoadConfig = async () => PKG;

async function scaffold(projectDir: string) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: PKG.packageName }));
  await init({ cwd: projectDir, ...PKG, log: noop, exec: noopExec });
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

    await deinit({
      cwd: dir,
      log: noop,
      confirm: async () => true,
      loadConfig: fakeLoadConfig,
      exec: noopExec,
    });

    for (const f of MANAGED_FILES) {
      expect(existsSync(join(dir, f))).toBe(false);
    }
  });

  test("skips missing files gracefully", async () => {
    const dir = join(tempDir, "empty-dir");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: PKG.packageName }));

    // Should not throw
    await deinit({
      cwd: dir,
      log: noop,
      confirm: async () => true,
      loadConfig: fakeLoadConfig,
      exec: noopExec,
    });
  });

  test("cleans up empty .github directories", async () => {
    const dir = join(tempDir, "cleanup-dirs");
    await scaffold(dir);

    await deinit({
      cwd: dir,
      log: noop,
      confirm: async () => true,
      loadConfig: fakeLoadConfig,
      exec: noopExec,
    });

    expect(existsSync(join(dir, ".github/workflows"))).toBe(false);
    expect(existsSync(join(dir, ".github"))).toBe(false);
  });

  test("preserves non-managed files in .github/workflows", async () => {
    const dir = join(tempDir, "preserve-custom");
    await scaffold(dir);

    const customWorkflow = join(dir, ".github/workflows/custom.yml");
    await writeFile(customWorkflow, "name: Custom");

    await deinit({
      cwd: dir,
      log: noop,
      confirm: async () => true,
      loadConfig: fakeLoadConfig,
      exec: noopExec,
    });

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
      exec: noopExec,
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
      exec: noopExec,
      confirm: async () => false,
    });

    expect(existsSync(ciPath)).toBe(true);
    // Unmodified files should still be removed
    expect(existsSync(join(dir, ".github/workflows/publish.yml"))).toBe(false);
  });

  test("treats all files as modified when config cannot load", async () => {
    const dir = join(tempDir, "no-config");
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: PKG.packageName }));
    await writeFile(join(dir, ".github/workflows/ci.yml"), "name: CI");
    await writeFile(join(dir, ".github/workflows/publish.yml"), "name: Publish");

    const confirmCalls: string[] = [];
    await deinit({
      cwd: dir,
      log: noop,
      exec: noopExec,
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
      exec: noopExec,
    });

    // 4 managed files + cache file
    const removed = logs.filter((l) => l.includes("Removed"));
    expect(removed.length).toBe(5);
    expect(removed.some((l) => l.includes(CACHE_FILE))).toBe(true);
  });
});

describe("deinit project teardown", () => {
  let tempDir: string;

  const initOpts = (cwd: string, extra: Record<string, unknown> = {}) => ({
    cwd,
    ...PKG,
    log: noop,
    exec: noopExec,
    ...extra,
  });

  const deinitOpts = (cwd: string, extra: Record<string, unknown> = {}) => ({
    cwd,
    log: noop,
    confirm: async () => true,
    loadConfig: fakeLoadConfig,
    exec: noopExec,
    ...extra,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-tools-teardown-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("removes scripts that were added by init (cached as null)", async () => {
    const dir = join(tempDir, "scripts-remove");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await init(initOpts(dir));

    // Verify scripts were added
    let pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.typecheck).toBe(MANAGED_SCRIPTS.typecheck);

    await deinit(deinitOpts(dir));

    pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    for (const key of Object.keys(MANAGED_SCRIPTS)) {
      expect(pkg.scripts?.[key]).toBeUndefined();
    }
  });

  test("restores original scripts from cache", async () => {
    const dir = join(tempDir, "scripts-restore");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        { name: "test-pkg", scripts: { lint: "prettier --write .", check: "tsc" } },
        null,
        2
      )
    );
    await init(initOpts(dir));

    await deinit(deinitOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.lint).toBe("prettier --write .");
    expect(pkg.scripts.check).toBe("tsc");
    // Scripts that didn't exist before should be gone
    expect(pkg.scripts.knip).toBeUndefined();
    expect(pkg.scripts.prepare).toBeUndefined();
  });

  test("removes lint-staged when it was added by init", async () => {
    const dir = join(tempDir, "lint-staged-remove");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await init(initOpts(dir));

    await deinit(deinitOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg["lint-staged"]).toBeUndefined();
  });

  test("restores original lint-staged config from cache", async () => {
    const dir = join(tempDir, "lint-staged-restore");
    await mkdir(dir);
    const originalLintStaged = { "*.ts": ["eslint --fix"] };
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", "lint-staged": originalLintStaged }, null, 2)
    );
    await init(initOpts(dir));

    await deinit(deinitOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg["lint-staged"]).toEqual(originalLintStaged);
  });

  test("removes tsconfig baseUrl and paths when added by init", async () => {
    const dir = join(tempDir, "tsconfig-remove");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2)
    );
    await init(initOpts(dir));

    await deinit(deinitOpts(dir));

    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
    expect(tsconfig.compilerOptions.paths).toBeUndefined();
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  test("restores original tsconfig values from cache", async () => {
    const dir = join(tempDir, "tsconfig-restore");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        { compilerOptions: { baseUrl: "./src", paths: { "~/*": ["lib/*"] }, strict: true } },
        null,
        2
      )
    );
    await init(initOpts(dir));

    await deinit(deinitOpts(dir));

    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.baseUrl).toBe("./src");
    expect(tsconfig.compilerOptions.paths).toEqual({ "~/*": ["lib/*"] });
  });

  test("uninstalls only deps tracked in cache", async () => {
    const dir = join(tempDir, "deps-uninstall");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", devDependencies: { husky: "^9.0.0" } }, null, 2)
    );
    await init(initOpts(dir));

    const execCalls: string[][] = [];
    await deinit(
      deinitOpts(dir, {
        exec: async (cmd: string[]) => {
          execCalls.push(cmd);
        },
      })
    );

    expect(execCalls).toHaveLength(1);
    const cmd = execCalls.at(0);
    if (!cmd) throw new Error("expected exec call");
    expect(cmd[0]).toBe("bun");
    expect(cmd[1]).toBe("remove");
    // Should NOT include husky since it was already present
    expect(cmd).not.toContain("husky");
    // Should include the rest
    expect(cmd).toContain("lint-staged");
    expect(cmd).toContain("knip");
    expect(cmd).toContain("@biomejs/biome");
  });

  test("skips exec when no deps to uninstall", async () => {
    const dir = join(tempDir, "deps-skip");
    await mkdir(dir);
    const devDeps = Object.fromEntries(MANAGED_DEPS.map((d) => [d, "^1.0.0"]));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", devDependencies: devDeps }, null, 2)
    );
    await init(initOpts(dir));

    const execCalls: string[][] = [];
    await deinit(
      deinitOpts(dir, {
        exec: async (cmd: string[]) => {
          execCalls.push(cmd);
        },
      })
    );

    expect(execCalls.length).toBe(0);
  });

  test("deletes cache file after restoration", async () => {
    const dir = join(tempDir, "cache-delete");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await init(initOpts(dir));
    expect(existsSync(join(dir, CACHE_FILE))).toBe(true);

    await deinit(deinitOpts(dir));

    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });

  test("skips project restoration when no cache file exists", async () => {
    const dir = join(tempDir, "no-cache");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", scripts: { test: "vitest" } }, null, 2)
    );

    const logs: string[] = [];
    await deinit(deinitOpts(dir, { log: (msg: string) => logs.push(msg) }));

    expect(logs.some((l) => l.includes("no cache"))).toBe(true);
    // package.json should be untouched
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.test).toBe("vitest");
  });

  test("handles missing tsconfig.json gracefully during deinit", async () => {
    const dir = join(tempDir, "tsconfig-gone");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2)
    );
    await init(initOpts(dir));

    // Remove tsconfig.json after init
    const { unlink } = await import("node:fs/promises");
    await unlink(join(dir, "tsconfig.json"));

    // Should not throw
    const logs: string[] = [];
    await deinit(deinitOpts(dir, { log: (msg: string) => logs.push(msg) }));

    expect(logs.some((l) => l.includes("tsconfig.json"))).toBe(true);
  });

  test("full round-trip: init then deinit restores original state", async () => {
    const dir = join(tempDir, "round-trip");
    await mkdir(dir);

    const originalPkg = {
      name: "test-pkg",
      scripts: { test: "vitest", lint: "eslint .", dev: "bun run src/index.ts" },
      "lint-staged": { "*.ts": ["eslint --fix"] },
      devDependencies: { husky: "^9.0.0" },
    };
    const originalTsconfig = {
      compilerOptions: {
        strict: true,
        target: "ESNext",
        baseUrl: "./src",
        paths: { "~/*": ["lib/*"] },
      },
    };

    const originalPkgStr = `${JSON.stringify(originalPkg, null, 2)}\n`;
    const originalTsconfigStr = `${JSON.stringify(originalTsconfig, null, 2)}\n`;

    await writeFile(join(dir, "package.json"), originalPkgStr);
    await writeFile(join(dir, "tsconfig.json"), originalTsconfigStr);

    await init(initOpts(dir));

    // Verify init changed things
    const pkgAfterInit = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkgAfterInit.scripts.lint).toBe(MANAGED_SCRIPTS.lint);
    expect(pkgAfterInit.scripts.typecheck).toBe(MANAGED_SCRIPTS.typecheck);

    await deinit(deinitOpts(dir));

    // Verify byte-for-byte restoration
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(originalPkgStr);
    expect(readFileSync(join(dir, "tsconfig.json"), "utf-8")).toBe(originalTsconfigStr);
    expect(existsSync(join(dir, CACHE_FILE))).toBe(false);
  });
});
