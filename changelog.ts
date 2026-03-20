import { $ } from "bun";

export type CommandRunner = (
  strings: TemplateStringsArray,
  ...values: readonly string[]
) => { text: () => Promise<string> };

export type ChangelogConfig = {
  repo: string;
  excludedAuthors?: string[];
  commitPattern?: RegExp;
};

const DEFAULT_RUNNER: CommandRunner = $;
const DEFAULT_EXCLUDED_AUTHORS = ["actions-user", "github-actions[bot]"];
const DEFAULT_COMMIT_PATTERN = /^(feat|fix)(\([^)]+\))?:/i;

/**
 * Check if a commit message should be included in the changelog.
 * @param message - The commit message (can include hash prefix like "abc1234 feat: message")
 * @param pattern - Regex to match against (default: feat/fix with optional scope)
 */
export function isIncludedCommit(
  message: string,
  pattern: RegExp = DEFAULT_COMMIT_PATTERN
): boolean {
  const messageWithoutHash = message.replace(/^\w+\s+/, "");
  return pattern.test(messageWithoutHash);
}

export async function getLatestReleasedTag(
  runner: CommandRunner = DEFAULT_RUNNER
): Promise<string | null> {
  try {
    const tag =
      await runner`gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty'`.text();
    return tag.trim() || null;
  } catch {
    return null;
  }
}

export function formatReleaseNotes(changelog: string[], contributors: string[]): string[] {
  const notes: string[] = [];

  if (changelog.length > 0) {
    notes.push(...changelog);
  } else {
    notes.push("No changes in this release");
  }

  if (contributors.length > 0) {
    notes.push(...contributors);
  }

  return notes;
}

export type GenerateChangelogOptions = {
  runner?: CommandRunner;
  commitPattern?: RegExp;
};

export async function generateChangelog(
  previousTag: string,
  options: GenerateChangelogOptions = {}
): Promise<string[]> {
  const runner = options.runner ?? DEFAULT_RUNNER;
  const pattern = options.commitPattern ?? DEFAULT_COMMIT_PATTERN;

  let log: string;
  try {
    log = await runner`git log ${previousTag}..HEAD --oneline --format="%h %s"`.text();
  } catch {
    try {
      log = await runner`git log HEAD --oneline --format="%h %s"`.text();
    } catch {
      return [];
    }
  }

  return log
    .split("\n")
    .filter((line) => line && isIncludedCommit(line, pattern))
    .map((commit) => `- ${commit}`);
}

export type GetContributorsOptions = {
  repo: string;
  excludedAuthors?: string[];
  commitPattern?: RegExp;
  runner?: CommandRunner;
};

export async function getContributors(
  previousTag: string,
  options: GetContributorsOptions
): Promise<string[]> {
  const runner = options.runner ?? DEFAULT_RUNNER;
  const excludedAuthors = options.excludedAuthors ?? DEFAULT_EXCLUDED_AUTHORS;
  const pattern = options.commitPattern ?? DEFAULT_COMMIT_PATTERN;
  const notes: string[] = [];

  try {
    const compare =
      await runner`gh api "/repos/${options.repo}/compare/${previousTag}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text();
    const contributors = new Map<string, string[]>();

    for (const line of compare.split("\n").filter(Boolean)) {
      const { login, message } = JSON.parse(line) as {
        login: string | null;
        message: string;
      };
      const title = message.split("\n")[0] ?? "";
      if (!isIncludedCommit(title, pattern)) continue;

      if (login && !excludedAuthors.includes(login)) {
        if (!contributors.has(login)) contributors.set(login, []);
        contributors.get(login)?.push(title);
      }
    }

    if (contributors.size > 0) {
      notes.push("");
      notes.push(
        `**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`
      );
      for (const [username, userCommits] of contributors) {
        notes.push(`- @${username}:`);
        for (const commit of userCommits) {
          notes.push(`  - ${commit}`);
        }
      }
    }
  } catch {
    // Failed to fetch contributors
  }

  return notes;
}

export type RunChangelogOptions = {
  repo: string;
  excludedAuthors?: string[];
  commitPattern?: RegExp;
  runner?: CommandRunner;
  log?: (message: string) => void;
};

export async function runChangelog(options: RunChangelogOptions): Promise<void> {
  const runner = options.runner ?? DEFAULT_RUNNER;
  const log = options.log ?? console.log;
  const previousTag = await getLatestReleasedTag(runner);

  if (!previousTag) {
    log("Initial release");
    return;
  }

  const changelog = await generateChangelog(previousTag, {
    runner,
    commitPattern: options.commitPattern,
  });
  const contributors = await getContributors(previousTag, {
    repo: options.repo,
    excludedAuthors: options.excludedAuthors,
    commitPattern: options.commitPattern,
    runner,
  });
  const notes = formatReleaseNotes(changelog, contributors);

  log(notes.join("\n"));
}
