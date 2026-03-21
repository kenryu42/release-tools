import { describe, expect, test } from "bun:test";
import type { ReleaseToolsConfig } from "../../cli/config.ts";
import {
  generateCiWorkflow,
  generateConfigTemplate,
  generateLintWorkflow,
  generatePublishWorkflow,
} from "../../cli/templates/workflows.ts";

describe("generateConfigTemplate", () => {
  test("generates valid TypeScript with defineConfig import", () => {
    const template = generateConfigTemplate({
      packageName: "my-tool",
      repo: "owner/my-tool",
    });
    expect(template).toContain('import { defineConfig } from "release-tools/config"');
    expect(template).toContain("export default defineConfig");
  });

  test("includes packageName and repo", () => {
    const template = generateConfigTemplate({
      packageName: "test-pkg",
      repo: "owner/test-pkg",
    });
    expect(template).toContain("packageName: 'test-pkg'");
    expect(template).toContain("repo: 'owner/test-pkg'");
  });

  test("includes homebrew block when provided", () => {
    const template = generateConfigTemplate({
      packageName: "my-tool",
      repo: "owner/my-tool",
      homebrew: {
        tapRepo: "owner/homebrew-tap",
        formulaPath: "Formula/my-tool.rb",
        sourceRepo: "owner/my-tool",
      },
    });
    expect(template).toContain("homebrew:");
    expect(template).toContain("tapRepo: 'owner/homebrew-tap'");
  });

  test("omits homebrew block when not provided", () => {
    const template = generateConfigTemplate({
      packageName: "my-tool",
      repo: "owner/my-tool",
    });
    expect(template).not.toContain("homebrew:");
  });
});

describe("generatePublishWorkflow", () => {
  test("templates repo into github.repository guard", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
    };
    const workflow = generatePublishWorkflow(config);
    expect(workflow).toContain("if: github.repository == 'owner/my-tool'");
  });

  test("uses bunx release-tools publish command", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
    };
    const workflow = generatePublishWorkflow(config);
    expect(workflow).toContain("bunx release-tools publish");
  });

  test("includes homebrew step when config.homebrew exists", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
      homebrew: {
        tapRepo: "owner/homebrew-tap",
        formulaPath: "Formula/my-tool.rb",
        sourceRepo: "owner/my-tool",
      },
    };
    const workflow = generatePublishWorkflow(config);
    expect(workflow).toContain("Update Homebrew tap");
    expect(workflow).toContain("bunx release-tools homebrew");
  });

  test("omits homebrew step when config.homebrew is absent", () => {
    const config: ReleaseToolsConfig = {
      packageName: "my-tool",
      repo: "owner/my-tool",
    };
    const workflow = generatePublishWorkflow(config);
    expect(workflow).not.toContain("Update Homebrew tap");
  });
});

describe("generateCiWorkflow", () => {
  test("uses bunx release-tools changelog for draft release", () => {
    const workflow = generateCiWorkflow();
    expect(workflow).toContain("bunx release-tools changelog");
  });

  test("includes default paths", () => {
    const workflow = generateCiWorkflow();
    expect(workflow).toContain(".github/workflows/**");
    expect(workflow).toContain("src/**");
    expect(workflow).toContain("tests/**");
  });
});

describe("generateLintWorkflow", () => {
  test("returns static content", () => {
    const workflow = generateLintWorkflow();
    expect(workflow).toContain("Lint GitHub Actions Workflows");
    expect(workflow).toContain("actionlint");
  });
});
