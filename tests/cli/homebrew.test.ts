import { describe, expect, test } from "bun:test";
import { getHomebrewConfig, getVersion } from "@/cli/commands/homebrew.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";

describe("getVersion", () => {
  test("reads version from argv", () => {
    const version = getVersion(["bunx", "release-tools", "homebrew", "1.2.3"], {});
    expect(version).toBe("1.2.3");
  });

  test("reads version from VERSION env var", () => {
    const version = getVersion(["bunx", "release-tools", "homebrew"], { VERSION: "2.0.0" });
    expect(version).toBe("2.0.0");
  });

  test("throws when no version provided", () => {
    expect(() => getVersion(["bunx", "release-tools", "homebrew"], {})).toThrow("VERSION required");
  });
});

describe("getHomebrewConfig", () => {
  test("returns homebrew config when present", () => {
    const homebrewObj = {
      tapRepo: "owner/homebrew-tap",
      formulaPath: "Formula/my-tool.rb",
      sourceRepo: "owner/my-tool",
    };
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
      excludedAuthors: ["owner"],
      homebrew: homebrewObj,
    };
    const homebrewConfig = getHomebrewConfig(config);
    expect(homebrewConfig).toEqual(homebrewObj);
  });

  test("throws when homebrew config is absent", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
      excludedAuthors: ["owner"],
    };
    expect(() => getHomebrewConfig(config)).toThrow("Homebrew not configured");
  });
});
