import { existsSync } from "node:fs";
import { join } from "node:path";

export type ReleaseToolsConfig = {
  packageName: string;
  repo: string;
  releaseFiles?: string[];
  excludedAuthors: string[];
  publishCommand?: string[];
  homebrew?: {
    tapRepo: string;
    formulaPath: string;
    sourceRepo: string;
  };
};

export function defineConfig(config: ReleaseToolsConfig): ReleaseToolsConfig {
  return config;
}

export async function loadConfig(cwd: string): Promise<ReleaseToolsConfig> {
  const configPath = join(cwd, ".release-tools/config.ts");

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: .release-tools/config.ts\nRun "release-tools init" to create one.`
    );
  }

  const module = await import(configPath);
  return module.default as ReleaseToolsConfig;
}
