import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, loadConfig } from "@/cli/config.ts";

describe("defineConfig", () => {
  test("returns input unchanged", () => {
    const config = {
      packageName: "my-tool",
      repo: "owner/my-tool",
    };
    expect(defineConfig(config)).toEqual(config);
  });

  test("preserves all optional fields", () => {
    const config = {
      packageName: "my-tool",
      repo: "owner/my-tool",
      releaseFiles: ["package.json", "schema.json"],
      build: "bun run build",
      excludedAuthors: ["bot"],
      publishCommand: ["npm", "publish"],
      homebrew: {
        tapRepo: "owner/homebrew-tap",
        formulaPath: "Formula/my-tool.rb",
        sourceRepo: "owner/my-tool",
      },
    };
    expect(defineConfig(config)).toEqual(config);
  });
});

describe("loadConfig", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-tools-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("throws when config file does not exist", async () => {
    await expect(loadConfig(tempDir)).rejects.toThrow("release-tools.config.ts");
  });

  test("loads config from a valid file", async () => {
    const configContent = `
      export default {
        packageName: "test-pkg",
        repo: "owner/test-pkg",
      };
    `;
    await writeFile(join(tempDir, "release-tools.config.ts"), configContent);
    const config = await loadConfig(tempDir);
    expect(config).toEqual({
      packageName: "test-pkg",
      repo: "owner/test-pkg",
    });
  });
});
