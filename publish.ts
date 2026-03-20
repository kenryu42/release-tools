import { $ } from "bun";
import type { CommandRunner } from "./changelog.ts";
import { formatReleaseNotes, generateChangelog, getContributors } from "./changelog.ts";

export type BumpType = "major" | "minor" | "patch";
type FetchFn = (input: string | URL) => Promise<Response>;
type Environment = Record<string, string | undefined>;

export type PublishConfig = {
  packageName: string;
  releaseFiles: readonly string[];
  publishCommand?: readonly string[];
  build?: () => Promise<void>;
  updateVersionFiles?: (version: string) => Promise<void>;
  revertChanges?: () => Promise<void>;
  generateNotes?: (previousTag: string) => Promise<string[]>;
};

export type PublishOptions = {
  config: PublishConfig;
  argv?: readonly string[];
  env?: Environment;
  fetchFn?: FetchFn;
  runner?: CommandRunner;
  log?: (message: string) => void;
};

export function isBumpType(value: unknown): value is BumpType {
  return value === "major" || value === "minor" || value === "patch";
}

function parseBump(value: string | undefined): BumpType | undefined {
  if (!value) return undefined;
  if (!isBumpType(value)) {
    throw new Error(`Invalid BUMP value "${value}". Use major, minor, or patch.`);
  }
  return value;
}

export function bumpVersion(version: string, type: BumpType): string {
  const parts = version.split(".").map((part) => Number(part));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function replacePackageVersion(packageJson: string, newVersion: string): string {
  const versionPattern = /"version"\s*:\s*"[^"]+"/;
  if (!versionPattern.test(packageJson)) {
    throw new Error("Could not find version field in package.json");
  }
  return packageJson.replace(versionPattern, `"version": "${newVersion}"`);
}

export function collectUnexpectedChanges(
  status: string,
  allowedFiles: readonly string[]
): string[] {
  return status
    .split("\n")
    .filter((line) => line.trim())
    .filter((line) => !allowedFiles.some((file) => line.includes(file)));
}

async function fetchPreviousVersion(
  packageName: string,
  fetchFn: FetchFn,
  log: (message: string) => void
): Promise<string | null> {
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${packageName}/latest`);
    if (!res.ok) {
      if (res.status === 404) {
        log("Package not found on npm - this appears to be the first publish");
        return "0.0.0";
      }
      throw new Error(`Failed to fetch: ${res.statusText}`);
    }
    const data = (await res.json()) as { version: string };
    log(`Previous version: ${data.version}`);
    return data.version;
  } catch (error) {
    log(`Failed to fetch previous version from npm: ${error}`);
    return null;
  }
}

async function checkVersionExists(
  packageName: string,
  version: string,
  fetchFn: FetchFn,
  log: (message: string) => void
): Promise<boolean | null> {
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${packageName}/${version}`);
    if (res.ok) return true;
    if (res.status === 404) return false;
    log(`npm registry returned ${res.status} for version check - treating as uncertain`);
    return null;
  } catch (error) {
    log(`npm registry check failed: ${error} - treating as uncertain`);
    return null;
  }
}

async function updatePackageVersion(
  newVersion: string,
  log: (message: string) => void
): Promise<void> {
  const packageJson = await Bun.file("package.json").text();
  await Bun.write("package.json", replacePackageVersion(packageJson, newVersion));
  log("Updated: package.json");
}

async function preflight(
  newVersion: string,
  previousVersion: string,
  isDryRun: boolean,
  releaseFiles: readonly string[],
  runner: CommandRunner,
  log: (message: string) => void
): Promise<void> {
  log("\nRunning preflight checks...\n");

  const status = await runner`git status --porcelain`.text();

  if (isDryRun) {
    if (status.trim()) {
      throw new Error(
        `Dry-run requires clean working directory. Uncommitted changes:\n${status}`
      );
    }
  } else {
    const unexpectedChanges = collectUnexpectedChanges(status, releaseFiles);
    if (unexpectedChanges.length > 0) {
      throw new Error(`Unexpected uncommitted changes:\n${unexpectedChanges.join("\n")}`);
    }
  }
  log("  Working directory is clean");

  const prevTag = `v${previousVersion}`;
  const tagCheck = await runner`git rev-parse ${prevTag}`.text().catch(() => null);
  if (tagCheck === null) {
    log(`  Previous tag ${prevTag} not found - changelog will include all commits`);
  } else {
    log(`  Previous tag ${prevTag} exists`);
  }

  const newTag = `v${newVersion}`;
  const newTagCheck = await runner`git rev-parse ${newTag}`.text().catch(() => null);
  if (newTagCheck !== null) {
    log(`  Tag ${newTag} already exists`);
  }

  log("\nPreflight checks passed\n");
}

async function runRecovery(
  packageName: string,
  executeRecovery: boolean,
  fetchFn: FetchFn,
  runner: CommandRunner,
  log: (message: string) => void
): Promise<void> {
  log("Recovery mode: checking for partial publish state...\n");

  const npmVersion = await fetchPreviousVersion(packageName, fetchFn, log);
  if (npmVersion === null) {
    throw new Error("Cannot determine npm version - recovery aborted");
  }

  if (npmVersion === "0.0.0") {
    const exists = await checkVersionExists(packageName, "0.0.0", fetchFn, log);
    if (exists === null) {
      throw new Error("Cannot verify if 0.0.0 exists on npm - recovery aborted");
    }
    if (exists === false) {
      throw new Error("Package not found on npm - nothing to recover");
    }
  }

  const tagResult = await runner`git rev-parse v${npmVersion}`.text().catch(() => null);
  const tagExists = tagResult !== null;

  const releaseResult = await runner`gh release view v${npmVersion}`.text().catch(() => null);
  const releaseExists = releaseResult !== null;

  log(`\nnpm version: ${npmVersion}`);
  log(`Git tag v${npmVersion}: ${tagExists ? "exists" : "missing"}`);
  log(`GitHub release: ${releaseExists ? "exists" : "missing"}`);

  if (tagExists && releaseExists) {
    log("\nNo recovery needed - all artifacts exist");
    return;
  }

  if (!executeRecovery) {
    log("\nUse --recover --execute to create missing artifacts.");
    return;
  }

  log("\nExecuting recovery...");

  if (!tagExists) {
    const headSha = (await runner`git rev-parse --short HEAD`.text()).trim();
    const branch = (await runner`git branch --show-current`.text()).trim();
    log(`Warning: Will tag current HEAD (${headSha} on ${branch})`);
    log("Ensure this is the commit that was published to npm!");
    log(`Creating missing tag v${npmVersion}...`);
    await runner`git tag v${npmVersion}`.text();
    await runner`git push origin v${npmVersion}`.text();
  }

  if (!releaseExists) {
    log(`Creating missing release v${npmVersion}...`);
    await runner`gh release create v${npmVersion} --title "v${npmVersion}" --notes "Recovery release"`.text();
  }

  log("\nRecovery complete");
}

async function runDryRun(
  config: PublishConfig,
  newVersion: string,
  previousVersion: string,
  runner: CommandRunner,
  log: (message: string) => void
): Promise<void> {
  log("\n[DRY-RUN] Simulating full publish flow...\n");

  await preflight(newVersion, previousVersion, true, config.releaseFiles, runner, log);

  try {
    if (config.updateVersionFiles) {
      await config.updateVersionFiles(newVersion);
    } else {
      await updatePackageVersion(newVersion, log);
    }

    if (config.build) {
      log("\nBuilding...");
      await config.build();
    }

    const fileArgs = config.releaseFiles.join(" ");
    await runner`git add ${fileArgs}`.text();
    const staged = await runner`git diff --cached --stat`.text();
    log("[DRY-RUN] Would commit:");
    log(staged);

    let notes: string[];
    if (config.generateNotes) {
      notes = await config.generateNotes(`v${previousVersion}`);
    } else {
      const changelog = await generateChangelog(`v${previousVersion}`, { runner });
      const contributors = await getContributors(`v${previousVersion}`, {
        repo: config.packageName,
        runner,
      });
      notes = formatReleaseNotes(changelog, contributors);
    }

    log("\n--- Release Notes ---");
    log(notes.length > 0 ? notes.join("\n") : "No notable changes");

    log(`\n[DRY-RUN] All checks passed - would publish ${config.packageName}@${newVersion}`);
  } catch (error) {
    log("\n[DRY-RUN] Simulation failed");
    throw error;
  } finally {
    await runner`git reset HEAD`.text().catch(() => {});
    if (config.revertChanges) {
      await config.revertChanges();
    } else {
      const fileArgs = config.releaseFiles.join(" ");
      await runner`git checkout -- ${fileArgs}`.text().catch(() => {});
    }
  }
}

async function gitCommitTagPush(
  newVersion: string,
  releaseFiles: readonly string[],
  runner: CommandRunner,
  log: (message: string) => void
): Promise<void> {
  log("\nCommitting and tagging...");
  await runner`git config user.email "github-actions[bot]@users.noreply.github.com"`.text();
  await runner`git config user.name "github-actions[bot]"`.text();

  const fileArgs = releaseFiles.join(" ");
  await runner`git add ${fileArgs}`.text();

  const hasStagedChanges = await runner`git diff --cached --quiet`.text().catch(() => "changed");
  if (hasStagedChanges === "changed") {
    await runner`git commit -m "release: v${newVersion}"`.text();
  } else {
    log("No changes to commit (version already updated)");
  }

  const tagExists = await runner`git rev-parse v${newVersion}`.text().catch(() => null);
  if (tagExists === null) {
    await runner`git tag v${newVersion}`.text();
  } else {
    log(`Tag v${newVersion} exists from failed previous publish - updating to current HEAD`);
    await runner`git tag -f v${newVersion}`.text();
  }

  await runner`git push origin HEAD`.text();
  await runner`git push origin v${newVersion} --force`.text();
}

async function npmPublish(
  publishCommand: readonly string[],
  log: (message: string) => void
): Promise<void> {
  log("Publishing to npm...");
  const publishResult = Bun.spawnSync([...publishCommand]);
  if (publishResult.exitCode !== 0) {
    throw new Error(`npm publish failed: ${publishResult.stderr.toString()}`);
  }
}

async function createGitHubRelease(
  newVersion: string,
  notes: string[],
  runner: CommandRunner,
  log: (message: string) => void
): Promise<void> {
  log("\nCreating GitHub release...");
  const releaseNotes = notes.length > 0 ? notes.join("\n") : "No notable changes";
  const releaseExists = await runner`gh release view v${newVersion}`.text().catch(() => null);
  if (releaseExists === null) {
    await runner`gh release create v${newVersion} --title "v${newVersion}" --notes ${releaseNotes}`.text();
  } else {
    log(`Release v${newVersion} already exists`);
  }
}

export async function runPublish(options: PublishOptions): Promise<void> {
  const { config } = options;
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const fetchFn = options.fetchFn ?? fetch;
  const runner = options.runner ?? $;
  const log = options.log ?? console.log;
  const bump = parseBump(env.BUMP);
  const versionOverride = env.VERSION;
  const dryRun = argv.includes("--dry-run");
  const recoverMode = argv.includes("--recover");
  const executeRecovery = argv.includes("--execute");
  const publishCommand = config.publishCommand ?? [
    "npm",
    "publish",
    "--access",
    "public",
    "--provenance",
  ];

  log(`=== ${dryRun ? "[DRY-RUN] " : ""}Publishing ${config.packageName} ===\n`);

  if (recoverMode) {
    await runRecovery(config.packageName, executeRecovery, fetchFn, runner, log);
    return;
  }

  const previous = await fetchPreviousVersion(config.packageName, fetchFn, log);

  if (previous === null && !versionOverride) {
    throw new Error(
      "Cannot determine previous version from npm. Set VERSION=x.y.z explicitly to proceed."
    );
  }

  const previousForChangelog = previous ?? "0.0.0";

  const newVersion =
    versionOverride ||
    (bump ? bumpVersion(previousForChangelog, bump) : bumpVersion(previousForChangelog, "patch"));
  log(`New version: ${newVersion}\n`);

  if (dryRun) {
    await runDryRun(config, newVersion, previousForChangelog, runner, log);
    return;
  }

  const versionExists = await checkVersionExists(config.packageName, newVersion, fetchFn, log);
  if (versionExists === true) {
    log(`Version ${newVersion} already exists on npm. Skipping publish.`);
    return;
  }
  if (versionExists === null) {
    throw new Error(
      `Cannot confirm version ${newVersion} is unpublished (npm check failed). ` +
        "Retry when npm is reachable, or use --recover for manual recovery."
    );
  }

  if (!env.CI) {
    throw new Error("Not in CI environment. Use --dry-run to test locally.");
  }

  await preflight(newVersion, previousForChangelog, false, config.releaseFiles, runner, log);

  if (config.updateVersionFiles) {
    await config.updateVersionFiles(newVersion);
  } else {
    await updatePackageVersion(newVersion, log);
  }

  let notes: string[];
  if (config.generateNotes) {
    notes = await config.generateNotes(`v${previousForChangelog}`);
  } else {
    const changelog = await generateChangelog(`v${previousForChangelog}`, { runner });
    const contributors = await getContributors(`v${previousForChangelog}`, {
      repo: config.packageName,
      runner,
    });
    notes = formatReleaseNotes(changelog, contributors);
  }

  if (config.build) {
    log("\nBuilding...");
    await config.build();
  }

  await gitCommitTagPush(newVersion, config.releaseFiles, runner, log);

  await npmPublish(publishCommand, log);

  await createGitHubRelease(newVersion, notes, runner, log);

  log(`\n=== Successfully published ${config.packageName}@${newVersion} ===`);
}
