import type { RunChangelogOptions } from "@/changelog.ts";
import { runChangelog } from "@/changelog.ts";
import type { ReleaseToolsConfig } from "@/cli/config.ts";
import { loadConfig } from "@/cli/config.ts";

export function buildChangelogOptions(config: ReleaseToolsConfig): RunChangelogOptions {
  return {
    repo: config.repo,
    excludedAuthors: config.excludedAuthors,
  };
}

export async function run(): Promise<void> {
  const config = await loadConfig(process.cwd());
  const options = buildChangelogOptions(config);
  await runChangelog(options);
}
