import type { ReleaseToolsConfig } from "@/cli/config.ts";
import { loadConfig } from "@/cli/config.ts";
import { runUpdateHomebrew } from "@/homebrew.ts";

export function getVersion(
  argv: readonly string[],
  env: Record<string, string | undefined>
): string {
  const versionArg = argv[3];
  if (versionArg) return versionArg;

  const envVersion = env.VERSION;
  if (envVersion) return envVersion;

  throw new Error("VERSION required as argument or environment variable");
}

export function getHomebrewConfig(config: ReleaseToolsConfig) {
  if (!config.homebrew) {
    throw new Error("Homebrew not configured in release-tools.config.ts");
  }
  return config.homebrew;
}

export async function run(): Promise<void> {
  const config = await loadConfig(process.cwd());
  const homebrewConfig = getHomebrewConfig(config);
  const version = getVersion(process.argv, process.env);

  await runUpdateHomebrew(version, { config: homebrewConfig });
}
