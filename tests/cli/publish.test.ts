import { describe, expect, test } from "bun:test";
import { adaptConfig } from "@/cli/commands/publish.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";

describe("adaptConfig", () => {
  test("passes packageName through", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
    };
    const adapted = adaptConfig(config);
    expect(adapted.packageName).toBe("my-pkg");
  });

  test("defaults releaseFiles to ['package.json']", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
    };
    const adapted = adaptConfig(config);
    expect(adapted.releaseFiles).toEqual(["package.json"]);
  });

  test("uses provided releaseFiles", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      releaseFiles: ["package.json", "schema.json"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.releaseFiles).toEqual(["package.json", "schema.json"]);
  });

  test("passes publishCommand through", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      publishCommand: ["bun", "publish"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.publishCommand).toEqual(["bun", "publish"]);
  });

  test("converts build string to async function", async () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      build: "echo test",
    };
    const adapted = adaptConfig(config);
    expect(adapted.build).toBeDefined();
    await adapted.build?.();
  });

  test("always provides generateNotes using config.repo", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/my-repo",
    };
    const adapted = adaptConfig(config);
    expect(adapted.generateNotes).toBeDefined();
  });
});
