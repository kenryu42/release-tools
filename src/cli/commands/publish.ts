import { buildReleaseNotes } from "@/changelog.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import { loadConfig } from "@/cli/config.ts";
import type { PublishConfig } from "@/publish.ts";
import { runPublish } from "@/publish.ts";

export function adaptConfig(config: ReleaseToolsConfig): PublishConfig {
  return {
    packageName: config.packageName,
    releaseFiles: config.releaseFiles ?? ["package.json"],
    publishCommand: config.publishCommand,
    generateNotes: (previousTag: string) =>
      buildReleaseNotes(previousTag, {
        repo: config.repo,
        excludedAuthors: config.excludedAuthors,
      }),
  };
}

export async function run(): Promise<void> {
  const config = await loadConfig(process.cwd());
  const adaptedConfig = adaptConfig(config);

  await runPublish({
    config: adaptedConfig,
    argv: process.argv,
    env: process.env,
  });
}
