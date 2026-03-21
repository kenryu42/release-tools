import { describe, expect, test } from "bun:test";
import { buildChangelogOptions } from "../../cli/commands/changelog.ts";
import type { ReleaseToolsConfig } from "../../cli/config.ts";

describe("buildChangelogOptions", () => {
  test("passes repo and excludedAuthors from config", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
      excludedAuthors: ["bot"],
    };
    const options = buildChangelogOptions(config);
    expect(options.repo).toBe("owner/repo");
    expect(options.excludedAuthors).toEqual(["bot"]);
  });

  test("works without excludedAuthors", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-pkg",
      repo: "owner/repo",
    };
    const options = buildChangelogOptions(config);
    expect(options.repo).toBe("owner/repo");
    expect(options.excludedAuthors).toBeUndefined();
  });
});
