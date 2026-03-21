import { describe, expect, test } from "bun:test";
import { createMockRunner } from "tests/testing";
import {
  buildReleaseNotes,
  formatReleaseNotes,
  generateChangelog,
  getContributors,
  getLatestReleasedTag,
  isIncludedCommit,
  runChangelog,
} from "@/changelog.ts";

describe("isIncludedCommit", () => {
  test("matches feat and fix commits", () => {
    expect(isIncludedCommit("feat: add feature")).toBe(true);
    expect(isIncludedCommit("fix: broken thing")).toBe(true);
  });

  test("matches commits with optional hash prefix", () => {
    expect(isIncludedCommit("abc1234 fix(parser): handle scope")).toBe(true);
  });

  test("matches commits with scope", () => {
    expect(isIncludedCommit("feat(cli): new flag")).toBe(true);
  });

  test("rejects non-feat/fix commits", () => {
    expect(isIncludedCommit("chore: update docs")).toBe(false);
    expect(isIncludedCommit("refactor: cleanup")).toBe(false);
  });

  test("respects custom commit pattern", () => {
    const customPattern = /^(feat|fix|perf)(\([^)]+\))?:/i;
    expect(isIncludedCommit("perf: optimize loop", customPattern)).toBe(true);
    expect(isIncludedCommit("chore: update docs", customPattern)).toBe(false);
  });
});

describe("generateChangelog", () => {
  test("generates flat changelog and filters non feat/fix commits", async () => {
    const runner = createMockRunner([
      [
        'git log v1.2.3..HEAD --oneline --format="%h %s"',
        [
          "a1b2c3d feat: add changelog generation",
          "b2c3d4e chore: update docs",
          "c3d4e5f fix(parser): handle scoped type",
        ].join("\n"),
      ],
    ]);

    const changelog = await generateChangelog("v1.2.3", { runner });

    expect(changelog).toEqual([
      "- a1b2c3d feat: add changelog generation",
      "- c3d4e5f fix(parser): handle scoped type",
    ]);
  });

  test("falls back to full log when tag-based git log fails", async () => {
    const runner = createMockRunner([
      ['git log v1.2.3..HEAD --oneline --format="%h %s"', new Error()],
      [
        'git log HEAD --oneline --format="%h %s"',
        ["a1b2c3d feat: add feature", "b2c3d4e chore: update docs"].join("\n"),
      ],
    ]);

    const changelog = await generateChangelog("v1.2.3", { runner });

    expect(changelog).toEqual(["- a1b2c3d feat: add feature"]);
  });

  test("returns empty list when both git log commands fail", async () => {
    const runner = createMockRunner([
      ['git log v1.2.3..HEAD --oneline --format="%h %s"', new Error()],
      ['git log HEAD --oneline --format="%h %s"', new Error()],
    ]);

    const changelog = await generateChangelog("v1.2.3", { runner });

    expect(changelog).toEqual([]);
  });

  test("uses custom commit pattern when provided", async () => {
    const runner = createMockRunner([
      [
        'git log v1.0.0..HEAD --oneline --format="%h %s"',
        ["a1b2c3d perf: optimize loop", "b2c3d4e feat: add feature", "c3d4e5f chore: cleanup"].join(
          "\n"
        ),
      ],
    ]);

    const changelog = await generateChangelog("v1.0.0", {
      runner,
      commitPattern: /^(perf)(\([^)]+\))?:/i,
    });

    expect(changelog).toEqual(["- a1b2c3d perf: optimize loop"]);
  });
});

describe("formatReleaseNotes", () => {
  test("combines changelog and contributors", () => {
    const notes = formatReleaseNotes(
      ["- a1b2c3d feat: add changelog generation"],
      ["", "**Thank you to 1 community contributor:**", "- @alice:", "  - feat: add parser"]
    );

    expect(notes).toEqual([
      "- a1b2c3d feat: add changelog generation",
      "",
      "**Thank you to 1 community contributor:**",
      "- @alice:",
      "  - feat: add parser",
    ]);
  });

  test("uses fallback message for empty changelog", () => {
    const notes = formatReleaseNotes([], []);
    expect(notes).toEqual(["No changes in this release"]);
  });
});

describe("getLatestReleasedTag", () => {
  test("returns tag when gh returns a value", async () => {
    const runner = createMockRunner([["gh release list", "v1.2.3\n"]]);
    await expect(getLatestReleasedTag(runner)).resolves.toBe("v1.2.3");
  });

  test("returns null when command fails", async () => {
    const runner = createMockRunner([["gh release list", new Error("gh unavailable")]]);
    await expect(getLatestReleasedTag(runner)).resolves.toBeNull();
  });

  test("returns null when output is empty", async () => {
    const runner = createMockRunner([["gh release list", ""]]);
    await expect(getLatestReleasedTag(runner)).resolves.toBeNull();
  });
});

describe("getContributors", () => {
  test("builds contributor block with feat/fix filtering", async () => {
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: improve output\n\nbody" }),
      JSON.stringify({ login: "alice", message: "chore: update lockfile\n\nbody" }),
      JSON.stringify({ login: "actions-user", message: "fix: bot commit\n\nbody" }),
      JSON.stringify({ login: "bob", message: "fix(cli): handle empty notes\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      ['gh api "/repos/example/repo/compare/v1.2.3...HEAD" --jq', compareOutput],
    ]);

    const contributors = await getContributors("v1.2.3", {
      repo: "example/repo",
      runner,
    });

    expect(contributors).toEqual([
      "",
      "**Thank you to 2 community contributors:**",
      "- @alice:",
      "  - feat: improve output",
      "- @bob:",
      "  - fix(cli): handle empty notes",
    ]);
  });

  test("uses custom excluded authors", async () => {
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: add thing\n\nbody" }),
      JSON.stringify({ login: "bot-user", message: "fix: automated fix\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      ['gh api "/repos/example/repo/compare/v1.0.0...HEAD" --jq', compareOutput],
    ]);

    const contributors = await getContributors("v1.0.0", {
      repo: "example/repo",
      excludedAuthors: ["bot-user"],
      runner,
    });

    expect(contributors).toEqual([
      "",
      "**Thank you to 1 community contributor:**",
      "- @alice:",
      "  - feat: add thing",
    ]);
  });

  test("returns empty array when API call fails", async () => {
    const runner = createMockRunner([
      ['gh api "/repos/example/repo/compare/v1.0.0...HEAD"', new Error("API error")],
    ]);

    const contributors = await getContributors("v1.0.0", {
      repo: "example/repo",
      runner,
    });

    expect(contributors).toEqual([]);
  });

  test("returns empty array when no external contributors", async () => {
    const compareOutput = JSON.stringify({
      login: "actions-user",
      message: "fix: bot commit",
    });
    const runner = createMockRunner([
      ['gh api "/repos/example/repo/compare/v1.0.0...HEAD" --jq', compareOutput],
    ]);

    const contributors = await getContributors("v1.0.0", {
      repo: "example/repo",
      runner,
    });

    expect(contributors).toEqual([]);
  });
});

describe("buildReleaseNotes", () => {
  test("combines changelog and contributors concurrently", async () => {
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: improve output\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      [
        'git log v1.0.0..HEAD --oneline --format="%h %s"',
        ["a1b2c3d feat: add feature", "b2c3d4e chore: update docs"].join("\n"),
      ],
      ['gh api "/repos/example/repo/compare/v1.0.0...HEAD" --jq', compareOutput],
    ]);

    const notes = await buildReleaseNotes("v1.0.0", {
      repo: "example/repo",
      runner,
    });

    expect(notes).toEqual([
      "- a1b2c3d feat: add feature",
      "",
      "**Thank you to 1 community contributor:**",
      "- @alice:",
      "  - feat: improve output",
    ]);
  });

  test("returns fallback message when no changes", async () => {
    const runner = createMockRunner([
      ['git log v1.0.0..HEAD --oneline --format="%h %s"', ""],
      ['gh api "/repos/example/repo/compare/v1.0.0...HEAD"', new Error("API error")],
    ]);

    const notes = await buildReleaseNotes("v1.0.0", {
      repo: "example/repo",
      runner,
    });

    expect(notes).toEqual(["No changes in this release"]);
  });
});

describe("runChangelog", () => {
  test("logs initial release when no previous tag exists", async () => {
    const messages: string[] = [];
    const runner = createMockRunner([["gh release list", ""]]);

    await runChangelog({
      repo: "example/repo",
      runner,
      log: (message) => messages.push(message),
    });

    expect(messages).toEqual(["Initial release"]);
  });

  test("logs changelog entries and contributors", async () => {
    const messages: string[] = [];
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: improve output\n\nbody" }),
      JSON.stringify({ login: "bob", message: "fix(cli): handle empty notes\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      ["gh release list", "v1.2.3\n"],
      [
        'git log v1.2.3..HEAD --oneline --format="%h %s"',
        [
          "a1b2c3d feat: add changelog generation",
          "b2c3d4e chore: update docs",
          "c3d4e5f fix(parser): handle scoped type",
        ].join("\n"),
      ],
      ['gh api "/repos/example/repo/compare/v1.2.3...HEAD" --jq', compareOutput],
    ]);

    await runChangelog({
      repo: "example/repo",
      runner,
      log: (message) => messages.push(message),
    });

    expect(messages).toEqual([
      [
        "- a1b2c3d feat: add changelog generation",
        "- c3d4e5f fix(parser): handle scoped type",
        "",
        "**Thank you to 2 community contributors:**",
        "- @alice:",
        "  - feat: improve output",
        "- @bob:",
        "  - fix(cli): handle empty notes",
      ].join("\n"),
    ]);
  });
});
