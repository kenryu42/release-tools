import { $ } from "bun";
import type { CommandRunner } from "@/changelog.ts";

type HomebrewConfig = {
  tapRepo: string;
  formulaPath: string;
  sourceRepo: string;
};

type UpdateHomebrewDeps = {
  config: HomebrewConfig;
  run?: CommandRunner;
  computeSha?: (url: string) => Promise<string>;
  log?: (message: string) => void;
};

export async function computeSha256(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText || `HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new Bun.CryptoHasher("sha256").update(buffer).digest("hex");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message.startsWith("Failed to download tarball:")
        ? message
        : `Failed to download tarball: ${message}`
    );
  }
}

export function updateFormula(
  formula: string,
  version: string,
  sha256: string,
  config: Pick<HomebrewConfig, "sourceRepo">
): string {
  const tarballUrl = `https://github.com/${config.sourceRepo}/archive/refs/tags/v${version}.tar.gz`;
  return formula
    .replace(/url "[^"]*"/, `url "${tarballUrl}"`)
    .replace(/sha256 "[^"]*"/, `sha256 "${sha256}"`);
}

export async function runUpdateHomebrew(
  version?: string,
  deps: UpdateHomebrewDeps = {} as UpdateHomebrewDeps
): Promise<void> {
  const { config } = deps;
  const run = deps.run ?? $;
  const computeSha = deps.computeSha ?? computeSha256;
  const log = deps.log ?? console.log;

  const newVersion = version ?? process.env.VERSION;
  if (!newVersion) {
    throw new Error("VERSION env var or argument is required");
  }

  log(`\n=== Updating Homebrew tap for v${newVersion} ===\n`);

  const tarballUrl = `https://github.com/${config.sourceRepo}/archive/refs/tags/v${newVersion}.tar.gz`;

  log("Computing SHA256...");
  const sha256 = await computeSha(tarballUrl);
  log(`SHA256: ${sha256}`);

  log("\nFetching current formula...");
  const raw = JSON.parse(
    await run`gh api "/repos/${config.tapRepo}/contents/${config.formulaPath}"`.text()
  );
  const formula = Buffer.from(raw.content, "base64").toString();
  const fileSha: string = raw.sha;

  const updated = updateFormula(formula, newVersion, sha256, config);

  log("Pushing updated formula...");
  const encoded = Buffer.from(updated).toString("base64");

  await run`gh api --method PUT "/repos/${config.tapRepo}/contents/${config.formulaPath}" \
    -f message=${`chore: bump to v${newVersion}`} \
    -f content=${encoded} \
    -f sha=${fileSha}`.text();

  log(`\n=== Homebrew tap updated to v${newVersion} ===`);
}
