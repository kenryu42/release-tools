import { describe, expect, test } from "bun:test";
import { adaptConfig } from "@/cli/commands/publish.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";

describe("adaptConfig", () => {
  test("passes packageName through", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      excludedAuthors: ["owner"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.packageName).toBe("my-pkg");
  });

  test("defaults releaseFiles to ['package.json']", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      excludedAuthors: ["owner"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.releaseFiles).toEqual(["package.json"]);
  });

  test("uses provided releaseFiles", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      excludedAuthors: ["owner"],
      releaseFiles: ["package.json", "schema.json"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.releaseFiles).toEqual(["package.json", "schema.json"]);
  });

  test("passes publishCommand through", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      excludedAuthors: ["owner"],
      publishCommand: ["bun", "publish"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.publishCommand).toEqual(["bun", "publish"]);
  });

  test("always provides generateNotes using config.repo", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/my-repo",
      excludedAuthors: ["owner"],
    };
    const adapted = adaptConfig(config);
    expect(adapted.generateNotes).toBeDefined();
  });
});
