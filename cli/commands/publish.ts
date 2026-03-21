import { buildReleaseNotes } from "../../changelog.ts";
import type { PublishConfig } from "../../publish.ts";
import { runPublish } from "../../publish.ts";
import type { ReleaseToolsConfig } from "../config.ts";
import { loadConfig } from "../config.ts";

export function adaptConfig(config: ReleaseToolsConfig): PublishConfig {
  const buildCmd = config.build;
  return {
    packageName: config.packageName,
    releaseFiles: config.releaseFiles ?? ["package.json"],
    publishCommand: config.publishCommand,
    build: buildCmd
      ? async () => {
          const parts = buildCmd.split(" ");
          const result = Bun.spawnSync(parts);
          if (result.exitCode !== 0) {
            throw new Error(
              `Build command failed with exit code ${result.exitCode}: ${buildCmd}\n${result.stderr.toString()}`
            );
          }
        }
      : undefined,
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
