import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CACHE_FILE,
  MANAGED_DEPS,
  MANAGED_LINT_STAGED,
  MANAGED_SCRIPTS,
  MANAGED_TSCONFIG,
  type ProjectSetupCache,
  run,
} from "@/cli/commands/init.ts";

const noop = () => {};
const noopExec = async () => {};

describe("init command", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-tools-init-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("creates config file at project root", async () => {
    const projectDir = join(tempDir, "project1");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      log: noop,
      exec: noopExec,
    });

    expect(existsSync(join(projectDir, ".release-tools/config.ts"))).toBe(true);
  });

  test("creates workflow files in .github/workflows/", async () => {
    const projectDir = join(tempDir, "project2");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      log: noop,
      exec: noopExec,
    });

    expect(existsSync(join(projectDir, ".github/workflows/publish.yml"))).toBe(true);
    expect(existsSync(join(projectDir, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(projectDir, ".github/workflows/lint-github-action-workflows.yml"))).toBe(
      true
    );
  });

  test("skips existing files without --force", async () => {
    const projectDir = join(tempDir, "project3");
    await mkdir(join(projectDir, ".release-tools"), { recursive: true });
    const configPath = join(projectDir, ".release-tools/config.ts");
    const originalContent = "// original";
    await writeFile(configPath, originalContent);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      log: noop,
      exec: noopExec,
    });

    expect(readFileSync(configPath, "utf-8")).toBe(originalContent);
  });

  test("overwrites existing files with --force", async () => {
    const projectDir = join(tempDir, "project4");
    await mkdir(join(projectDir, ".release-tools"), { recursive: true });
    const configPath = join(projectDir, ".release-tools/config.ts");
    await writeFile(configPath, "// original");
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: true,
      log: noop,
      exec: noopExec,
    });

    expect(readFileSync(configPath, "utf-8")).not.toBe("// original");
    expect(readFileSync(configPath, "utf-8")).toContain("defineConfig");
  });

  test("creates .github/workflows/ directory if needed", async () => {
    const projectDir = join(tempDir, "project5");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    expect(existsSync(join(projectDir, ".github"))).toBe(false);

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      log: noop,
      exec: noopExec,
    });

    expect(existsSync(join(projectDir, ".github/workflows"))).toBe(true);
  });

  test("includes homebrew in config when provided", async () => {
    const projectDir = join(tempDir, "project6");
    await mkdir(projectDir);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      homebrew: {
        tapRepo: "owner/homebrew-tap",
        formulaPath: "Formula/test-pkg.rb",
        sourceRepo: "owner/test-pkg",
      },
      log: noop,
      exec: noopExec,
    });

    const config = readFileSync(join(projectDir, ".release-tools/config.ts"), "utf-8");
    expect(config).toContain("homebrew:");
  });
});

describe("init project setup", () => {
  let tempDir: string;

  const PKG = { packageName: "test-pkg", repo: "owner/test-pkg" };
  const initOpts = (cwd: string, extra: Record<string, unknown> = {}) => ({
    cwd,
    ...PKG,
    log: noop,
    exec: noopExec,
    ...extra,
  });

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-tools-setup-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("adds all managed scripts to package.json", async () => {
    const dir = join(tempDir, "scripts-add");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));

    await run(initOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    for (const [key, value] of Object.entries(MANAGED_SCRIPTS)) {
      expect(pkg.scripts[key]).toBe(value);
    }
  });

  test("preserves existing non-managed scripts", async () => {
    const dir = join(tempDir, "scripts-preserve");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        { name: "test-pkg", scripts: { test: "vitest", dev: "bun run src/index.ts" } },
        null,
        2
      )
    );

    await run(initOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.test).toBe("vitest");
    expect(pkg.scripts.dev).toBe("bun run src/index.ts");
  });

  test("replaces existing same-name scripts and caches originals", async () => {
    const dir = join(tempDir, "scripts-replace");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        { name: "test-pkg", scripts: { lint: "prettier --write .", check: "tsc" } },
        null,
        2
      )
    );

    await run(initOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.lint).toBe(MANAGED_SCRIPTS.lint);
    expect(pkg.scripts.check).toBe(MANAGED_SCRIPTS.check);

    const cache: ProjectSetupCache = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    expect(cache.scripts.lint).toBe("prettier --write .");
    expect(cache.scripts.check).toBe("tsc");
  });

  test("adds lint-staged config to package.json", async () => {
    const dir = join(tempDir, "lint-staged");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));

    await run(initOpts(dir));

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg["lint-staged"]).toEqual(MANAGED_LINT_STAGED);
  });

  test("adds baseUrl and paths to tsconfig.json compilerOptions", async () => {
    const dir = join(tempDir, "tsconfig-add");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2)
    );

    await run(initOpts(dir));

    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.baseUrl).toBe(MANAGED_TSCONFIG.baseUrl);
    expect(tsconfig.compilerOptions.paths).toEqual(MANAGED_TSCONFIG.paths);
  });

  test("preserves existing tsconfig compilerOptions", async () => {
    const dir = join(tempDir, "tsconfig-preserve");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, target: "ESNext" } }, null, 2)
    );

    await run(initOpts(dir));

    const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.target).toBe("ESNext");
  });

  test("skips tsconfig modifications when tsconfig.json is missing", async () => {
    const dir = join(tempDir, "tsconfig-missing");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));

    const logs: string[] = [];
    await run(initOpts(dir, { log: (msg: string) => logs.push(msg) }));

    expect(existsSync(join(dir, "tsconfig.json"))).toBe(false);
    expect(logs.some((l) => l.includes("tsconfig.json"))).toBe(true);
  });

  test("creates cache file with correct structure", async () => {
    const dir = join(tempDir, "cache-structure");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", scripts: { lint: "eslint ." } }, null, 2)
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2)
    );

    await run(initOpts(dir));

    const cache: ProjectSetupCache = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    expect(cache.scripts).toBeDefined();
    expect(cache.scripts.lint).toBe("eslint .");
    expect(cache.lintStaged).toBeNull();
    expect(cache.tsconfig).toBeDefined();
    expect(cache.tsconfig?.baseUrl).toBeNull();
    expect(cache.tsconfig?.paths).toBeNull();
    expect(Array.isArray(cache.installedDeps)).toBe(true);
  });

  test("caches null for script keys that did not exist", async () => {
    const dir = join(tempDir, "cache-null");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));

    await run(initOpts(dir));

    const cache: ProjectSetupCache = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf-8"));
    for (const key of Object.keys(MANAGED_SCRIPTS)) {
      expect(cache.scripts[key]).toBeNull();
    }
  });

  test("does not overwrite existing cache file on repeated runs", async () => {
    const dir = join(tempDir, "cache-idempotent");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", scripts: { lint: "eslint ." } }, null, 2)
    );

    await run(initOpts(dir));
    const cacheAfterFirst = readFileSync(join(dir, CACHE_FILE), "utf-8");

    // Second run — scripts are now managed values, but cache should still have originals
    await run(initOpts(dir, { force: true }));
    const cacheAfterSecond = readFileSync(join(dir, CACHE_FILE), "utf-8");

    expect(cacheAfterSecond).toBe(cacheAfterFirst);
    const cache: ProjectSetupCache = JSON.parse(cacheAfterSecond);
    expect(cache.scripts.lint).toBe("eslint .");
  });

  test("installs only deps not already in devDependencies", async () => {
    const dir = join(tempDir, "deps-partial");
    await mkdir(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        { name: "test-pkg", devDependencies: { husky: "^9.0.0", knip: "^5.0.0" } },
        null,
        2
      )
    );

    const execCalls: string[][] = [];
    await run(
      initOpts(dir, {
        exec: async (cmd: string[]) => {
          execCalls.push(cmd);
        },
      })
    );

    expect(execCalls).toHaveLength(1);
    const cmd = execCalls.at(0);
    if (!cmd) throw new Error("expected exec call");
    expect(cmd).toContain("lint-staged");
    expect(cmd).toContain("@biomejs/biome");
    expect(cmd).not.toContain("husky");
    expect(cmd).not.toContain("knip");
  });

  test("skips dep install when all deps are already present", async () => {
    const dir = join(tempDir, "deps-all-present");
    await mkdir(dir);
    const devDeps = Object.fromEntries(MANAGED_DEPS.map((d) => [d, "^1.0.0"]));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", devDependencies: devDeps }, null, 2)
    );

    const execCalls: string[][] = [];
    await run(
      initOpts(dir, {
        exec: async (cmd: string[]) => {
          execCalls.push(cmd);
        },
      })
    );

    expect(execCalls.length).toBe(0);
  });

  test("calls exec with correct bun install arguments", async () => {
    const dir = join(tempDir, "deps-exec-args");
    await mkdir(dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "test-pkg" }, null, 2));

    const execCalls: string[][] = [];
    await run(
      initOpts(dir, {
        exec: async (cmd: string[]) => {
          execCalls.push(cmd);
        },
      })
    );

    expect(execCalls).toHaveLength(1);
    const cmd = execCalls.at(0);
    if (!cmd) throw new Error("expected exec call");
    expect(cmd[0]).toBe("bun");
    expect(cmd[1]).toBe("install");
    expect(cmd[2]).toBe("-d");
    for (const dep of MANAGED_DEPS) {
      expect(cmd).toContain(dep);
    }
  });
});
