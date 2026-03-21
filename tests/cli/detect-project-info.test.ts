import { describe, expect, test } from "bun:test";
import { detectProjectInfo } from "@/cli/commands/init.ts";

describe("detectProjectInfo", () => {
  test("extracts package name from package.json", async () => {
    const info = await detectProjectInfo({
      cwd: import.meta.dir,
      readFile: async () => JSON.stringify({ name: "my-package" }),
      gitRemoteUrl: async () => "git@github.com:owner/my-package.git",
    });

    expect(info.packageName).toBe("my-package");
  });

  test("extracts repo from SSH git remote", async () => {
    const info = await detectProjectInfo({
      cwd: import.meta.dir,
      readFile: async () => JSON.stringify({ name: "pkg" }),
      gitRemoteUrl: async () => "git@github.com:owner/repo.git",
    });

    expect(info.repo).toBe("owner/repo");
  });

  test("extracts repo from HTTPS git remote", async () => {
    const info = await detectProjectInfo({
      cwd: import.meta.dir,
      readFile: async () => JSON.stringify({ name: "pkg" }),
      gitRemoteUrl: async () => "https://github.com/owner/repo.git",
    });

    expect(info.repo).toBe("owner/repo");
  });

  test("extracts repo from HTTPS remote without .git suffix", async () => {
    const info = await detectProjectInfo({
      cwd: import.meta.dir,
      readFile: async () => JSON.stringify({ name: "pkg" }),
      gitRemoteUrl: async () => "https://github.com/owner/repo",
    });

    expect(info.repo).toBe("owner/repo");
  });

  test("throws when package.json has no name", async () => {
    expect(
      detectProjectInfo({
        cwd: import.meta.dir,
        readFile: async () => JSON.stringify({}),
        gitRemoteUrl: async () => "git@github.com:owner/repo.git",
      })
    ).rejects.toThrow('package.json is missing a "name" field');
  });

  test("throws when package.json is missing", async () => {
    expect(
      detectProjectInfo({
        cwd: import.meta.dir,
        readFile: async () => {
          throw new Error("ENOENT");
        },
        gitRemoteUrl: async () => "git@github.com:owner/repo.git",
      })
    ).rejects.toThrow("No package.json found");
  });

  test("throws when git remote is not available", async () => {
    expect(
      detectProjectInfo({
        cwd: import.meta.dir,
        readFile: async () => JSON.stringify({ name: "pkg" }),
        gitRemoteUrl: async () => {
          throw new Error("not a git repo");
        },
      })
    ).rejects.toThrow("Could not detect git remote");
  });

  test("throws when git remote URL is unparseable", async () => {
    expect(
      detectProjectInfo({
        cwd: import.meta.dir,
        readFile: async () => JSON.stringify({ name: "pkg" }),
        gitRemoteUrl: async () => "not-a-url",
      })
    ).rejects.toThrow("Could not parse repo from git remote");
  });
});
