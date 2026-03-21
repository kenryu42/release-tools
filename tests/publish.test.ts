import { describe, expect, test } from "bun:test";
import { createMockRunner } from "tests/mock-runner";
import {
  bumpVersion,
  collectUnexpectedChanges,
  isBumpType,
  replacePackageVersion,
  runPublish,
} from "@/publish.ts";

describe("isBumpType", () => {
  test("accepts valid bump types", () => {
    expect(isBumpType("major")).toBe(true);
    expect(isBumpType("minor")).toBe(true);
    expect(isBumpType("patch")).toBe(true);
  });

  test("rejects invalid values", () => {
    expect(isBumpType("invalid")).toBe(false);
    expect(isBumpType("")).toBe(false);
    expect(isBumpType(undefined)).toBe(false);
    expect(isBumpType(null)).toBe(false);
    expect(isBumpType(42)).toBe(false);
  });
});

describe("bumpVersion", () => {
  test("bumps major version", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("bumps minor version", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  test("bumps patch version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  test("handles 0.x versions", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.0.0", "major")).toBe("1.0.0");
  });
});

describe("replacePackageVersion", () => {
  test("replaces version field in package.json content", () => {
    const input = '{\n  "name": "foo",\n  "version": "1.0.0"\n}';
    const result = replacePackageVersion(input, "2.0.0");
    expect(result).toBe('{\n  "name": "foo",\n  "version": "2.0.0"\n}');
  });

  test("throws when version field is missing", () => {
    expect(() => replacePackageVersion('{"name": "foo"}', "1.0.0")).toThrow(
      "Could not find version field in package.json"
    );
  });

  test("handles various whitespace around version field", () => {
    const input = '"version":"1.0.0"';
    const result = replacePackageVersion(input, "2.0.0");
    expect(result).toBe('"version": "2.0.0"');
  });
});

describe("collectUnexpectedChanges", () => {
  test("returns empty for allowed files only", () => {
    const status = " M package.json\n M assets/schema.json\n";
    const result = collectUnexpectedChanges(status, ["package.json", "assets/schema.json"]);
    expect(result).toEqual([]);
  });

  test("returns unexpected files", () => {
    const status = " M package.json\n M src/index.ts\n";
    const result = collectUnexpectedChanges(status, ["package.json"]);
    expect(result).toEqual([" M src/index.ts"]);
  });

  test("handles empty status", () => {
    expect(collectUnexpectedChanges("", ["package.json"])).toEqual([]);
  });
});

describe("runPublish", () => {
  function makeFetch(responses: Record<string, { ok: boolean; status: number; data?: unknown }>) {
    return async (input: string | URL): Promise<Response> => {
      const url = String(input);
      for (const [pattern, resp] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return new Response(JSON.stringify(resp.data ?? {}), {
            status: resp.status,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response("not found", { status: 404 });
    };
  }

  test("dry-run succeeds with clean working directory", async () => {
    const logs: string[] = [];
    const runner = createMockRunner([
      // preflight: git status --porcelain (clean)
      ["git status --porcelain", ""],
      // preflight: git rev-parse previous tag
      ["git rev-parse v1.0.0", "abc123"],
      // preflight: git rev-parse new tag (not exists)
      ["git rev-parse v1.0.1", new Error("not found")],
      // git add
      ["git add", ""],
      // git diff --cached --stat
      ["git diff --cached --stat", " package.json | 2 +-\n"],
      // changelog: git log
      ['git log v1.0.0..HEAD --oneline --format="%h %s"', "abc1234 feat: new thing"],
      // contributors: gh api
      ['gh api "/repos/', ""],
      // git reset HEAD (cleanup)
      ["git reset HEAD", ""],
      // git checkout (revert)
      ["git checkout --", ""],
    ]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
    });

    // We need to intercept file operations. For dry-run test, we verify it doesn't throw.
    // The actual file I/O will fail since there's no package.json in cwd, so we provide
    // updateVersionFiles and revertChanges to avoid touching disk.
    await runPublish({
      config: {
        packageName: "test-pkg",
        releaseFiles: ["package.json"],
        updateVersionFiles: async () => {},
        revertChanges: async () => {},
      },
      argv: ["--dry-run"],
      env: {},
      fetchFn,
      runner,
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("DRY-RUN"))).toBe(true);
    expect(logs.some((l) => l.includes("All checks passed"))).toBe(true);
  });

  test("dry-run fails with dirty working directory", async () => {
    const runner = createMockRunner([["git status --porcelain", " M src/dirty.ts\n"]]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
    });

    await expect(
      runPublish({
        config: {
          packageName: "test-pkg",
          releaseFiles: ["package.json"],
        },
        argv: ["--dry-run"],
        env: {},
        fetchFn,
        runner,
        log: () => {},
      })
    ).rejects.toThrow("clean working directory");
  });

  test("recovery mode reports no recovery needed when all artifacts exist", async () => {
    const logs: string[] = [];
    const runner = createMockRunner([
      // git rev-parse tag (exists)
      ["git rev-parse v1.0.0", "abc123"],
      // gh release view (exists)
      ["gh release view v1.0.0", "Release v1.0.0"],
    ]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
    });

    await runPublish({
      config: {
        packageName: "test-pkg",
        releaseFiles: ["package.json"],
      },
      argv: ["--recover"],
      env: {},
      fetchFn,
      runner,
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("No recovery needed"))).toBe(true);
  });

  test("skips publish when version already exists on npm", async () => {
    const logs: string[] = [];
    const runner = createMockRunner([]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
      "/1.0.1": { ok: true, status: 200, data: { version: "1.0.1" } },
    });

    await runPublish({
      config: {
        packageName: "test-pkg",
        releaseFiles: ["package.json"],
      },
      argv: [],
      env: { CI: "true" },
      fetchFn,
      runner,
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("already exists on npm"))).toBe(true);
  });

  test("throws when not in CI and not dry-run", async () => {
    const runner = createMockRunner([]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
      "/1.0.1": { ok: false, status: 404 },
    });

    await expect(
      runPublish({
        config: {
          packageName: "test-pkg",
          releaseFiles: ["package.json"],
        },
        argv: [],
        env: {},
        fetchFn,
        runner,
        log: () => {},
      })
    ).rejects.toThrow("CI");
  });

  test("throws when npm lookup fails and no VERSION override", async () => {
    const fetchFn = async () => {
      throw new Error("network error");
    };

    await expect(
      runPublish({
        config: {
          packageName: "test-pkg",
          releaseFiles: ["package.json"],
        },
        argv: [],
        env: {},
        fetchFn,
        runner: createMockRunner([]),
        log: () => {},
      })
    ).rejects.toThrow("Cannot determine previous version");
  });

  test("uses VERSION override when npm is unreachable", async () => {
    const logs: string[] = [];
    const runner = createMockRunner([]);

    const fetchFn = async () => {
      throw new Error("network error");
    };

    // Should proceed past the npm check but fail at CI check
    await expect(
      runPublish({
        config: {
          packageName: "test-pkg",
          releaseFiles: ["package.json"],
        },
        argv: [],
        env: { VERSION: "2.0.0" },
        fetchFn,
        runner,
        log: (msg) => logs.push(msg),
      })
    ).rejects.toThrow(); // Will fail at checkVersionExists or CI check

    expect(logs.some((l) => l.includes("2.0.0"))).toBe(true);
  });

  test("calls build hook when provided", async () => {
    let buildCalled = false;
    const runner = createMockRunner([
      ["git status --porcelain", ""],
      ["git rev-parse v1.0.0", "abc123"],
      ["git rev-parse v1.0.1", new Error("not found")],
      ["git add", ""],
      ["git diff --cached --stat", " package.json | 2 +-\n"],
      ['git log v1.0.0..HEAD --oneline --format="%h %s"', ""],
      ['gh api "/repos/', ""],
      ["git reset HEAD", ""],
      ["git checkout --", ""],
    ]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
    });

    await runPublish({
      config: {
        packageName: "test-pkg",
        releaseFiles: ["package.json"],
        build: async () => {
          buildCalled = true;
        },
        updateVersionFiles: async () => {},
        revertChanges: async () => {},
      },
      argv: ["--dry-run"],
      env: {},
      fetchFn,
      runner,
      log: () => {},
    });

    expect(buildCalled).toBe(true);
  });

  test("calls generateNotes hook when provided", async () => {
    const runner = createMockRunner([
      ["git status --porcelain", ""],
      ["git rev-parse v1.0.0", "abc123"],
      ["git rev-parse v1.0.1", new Error("not found")],
      ["git add", ""],
      ["git diff --cached --stat", " package.json | 2 +-\n"],
      ["git reset HEAD", ""],
      ["git checkout --", ""],
    ]);

    const fetchFn = makeFetch({
      "/latest": { ok: true, status: 200, data: { version: "1.0.0" } },
    });

    let notesCalled = false;
    await runPublish({
      config: {
        packageName: "test-pkg",
        releaseFiles: ["package.json"],
        generateNotes: async (previousTag) => {
          notesCalled = true;
          expect(previousTag).toBe("v1.0.0");
          return ["custom note"];
        },
        updateVersionFiles: async () => {},
        revertChanges: async () => {},
      },
      argv: ["--dry-run"],
      env: {},
      fetchFn,
      runner,
      log: () => {},
    });

    expect(notesCalled).toBe(true);
  });
});
