import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { frontmatterAuthor, type SkillInfo } from "./skills";

const exec = promisify(execFile);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Remove transport syntax and credentials while retaining the repository owner. */
export function repositoryLabel(remote: string): string | undefined {
  const value = remote
    .trim()
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  const github =
    /^(?:https?:\/\/github\.com\/|ssh:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/.exec(
      value,
    );
  if (github) return github[1];
  try {
    const url = new URL(value);
    if (!["https:", "http:", "ssh:"].includes(url.protocol)) return;
    return `${url.hostname}${url.pathname}`;
  } catch {
    const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(value);
    return scp ? `${scp[1]}/${scp[2]}` : undefined;
  }
}

function lockedRepository(data: unknown, skill: SkillInfo): string | undefined {
  if (!isObject(data) || !isObject(data.skills)) return;
  for (const key of [
    skill.id,
    skill.name,
    dirname(skill.location).split(/[\\/]/).pop(),
  ]) {
    if (!key) continue;
    const entry = data.skills[key];
    if (!isObject(entry)) continue;
    if (typeof entry.sourceUrl === "string") {
      const label = repositoryLabel(entry.sourceUrl);
      if (label) return label;
    }
    if (
      entry.sourceType === "github" &&
      typeof entry.source === "string" &&
      /^[^/\s]+\/[^/\s]+$/.test(entry.source)
    )
      return entry.source;
  }
}

/** One resolver per catalogue refresh: shared file/Git lookups, no filesystem work during rendering. */
export function createProvenanceResolver() {
  const files = new Map<string, Promise<string>>();
  const origins = new Map<string, Promise<string | undefined>>();
  const gitRoots = new Map<string, Promise<boolean>>();
  const hasGit = (directory: string) => {
    let result = gitRoots.get(directory);
    if (!result) {
      result = stat(join(directory, ".git"))
        .then(() => true)
        .catch(() => false);
      gitRoots.set(directory, result);
    }
    return result;
  };
  const read = (path: string) => {
    let result = files.get(path);
    if (!result) {
      result = readFile(path, "utf8").catch(() => "");
      files.set(path, result);
    }
    return result;
  };
  const origin = (directory: string) => {
    let result = origins.get(directory);
    if (!result) {
      result = exec(
        "git",
        ["-C", directory, "config", "--get", "remote.origin.url"],
        { timeout: 2000 },
      )
        .then(({ stdout }) => repositoryLabel(stdout))
        .catch(() => undefined);
      origins.set(directory, result);
    }
    return result;
  };
  return async (skill: SkillInfo): Promise<SkillInfo> => {
    if (skill.author || !isAbsolute(skill.location)) return skill;
    const author = frontmatterAuthor(await read(skill.location));
    if (author) return { ...skill, author };
    const resolved = await realpath(skill.location).catch(() => skill.location);
    let repositoryRoot: string | undefined;
    for (const start of new Set([dirname(skill.location), dirname(resolved)])) {
      for (let directory = start; ; directory = dirname(directory)) {
        if (
          start === dirname(resolved) &&
          !repositoryRoot &&
          (await hasGit(directory))
        )
          repositoryRoot = directory;
        for (const filename of [".skill-lock.json", "skills-lock.json"]) {
          try {
            const repository = lockedRepository(
              JSON.parse(await read(join(directory, filename))),
              skill,
            );
            if (repository) return { ...skill, repository };
          } catch {
            // Absent or malformed installation records do not prevent Git fallback.
          }
        }
        if (dirname(directory) === directory) break;
      }
    }
    return {
      ...skill,
      repository: repositoryRoot ? await origin(repositoryRoot) : undefined,
    };
  };
}

export async function resolveCurrentSkills(
  items: readonly SkillInfo[],
  resolve: (skill: SkillInfo) => Promise<SkillInfo>,
  isCurrent: (items: readonly SkillInfo[]) => boolean,
  publish: (skills: SkillInfo[]) => void,
): Promise<void> {
  const skills = await Promise.all(items.map(resolve));
  if (isCurrent(items)) publish(skills);
}
