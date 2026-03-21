import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@/cli/commands/init.ts";

const noop = () => {};

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
    });

    expect(existsSync(join(projectDir, "release-tools.config.ts"))).toBe(true);
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
    });

    expect(existsSync(join(projectDir, ".github/workflows/publish.yml"))).toBe(true);
    expect(existsSync(join(projectDir, ".github/workflows/ci.yml"))).toBe(true);
    expect(existsSync(join(projectDir, ".github/workflows/lint-github-action-workflows.yml"))).toBe(
      true
    );
  });

  test("skips existing files without --force", async () => {
    const projectDir = join(tempDir, "project3");
    await mkdir(projectDir);
    const configPath = join(projectDir, "release-tools.config.ts");
    const originalContent = "// original";
    await writeFile(configPath, originalContent);
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: false,
      log: noop,
    });

    expect(readFileSync(configPath, "utf-8")).toBe(originalContent);
  });

  test("overwrites existing files with --force", async () => {
    const projectDir = join(tempDir, "project4");
    await mkdir(projectDir);
    const configPath = join(projectDir, "release-tools.config.ts");
    await writeFile(configPath, "// original");
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    await run({
      cwd: projectDir,
      packageName: "test-pkg",
      repo: "owner/test-pkg",
      force: true,
      log: noop,
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
    });

    const config = readFileSync(join(projectDir, "release-tools.config.ts"), "utf-8");
    expect(config).toContain("homebrew:");
  });
});
