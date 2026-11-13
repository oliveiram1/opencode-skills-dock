export type SkillScope = "global" | "local";

/** Config dir names that mark a "skill home" (either global under $HOME or local inside a project). */
const PROJECT_MARKERS = new Set([".opencode", ".claude", ".agents"]);

/** Normalise to a forward-slash absolute-ish path without trailing slash ("/" stays "/"). */
function normalizePath(p: string | undefined | null): string {
  if (!p) return "";
  let out = String(p)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  // collapse "." and ".." segments
  const abs = out.startsWith("/");
  const parts: string[] = [];
  for (const seg of out.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!abs) parts.push("..");
      continue;
    }
    parts.push(seg);
  }
  out = (abs ? "/" : "") + parts.join("/");
  return out === "" ? (abs ? "/" : "") : out;
}

/** True when `child` equals `parent` or lives somewhere below it. */
function isInside(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  if (!c || !p) return false;
  if (p === "/") return c.startsWith("/");
  return c === p || c.startsWith(p + "/");
}

/** Directories (under $HOME) that hold user-global skills. */
function globalSkillDirs(homeDir: string): string[] {
  const home = normalizePath(homeDir);
  if (!home) return [];
  return [
    `${home}/.config/opencode`,
    `${home}/.claude`,
    `${home}/.agents`,
    `${home}/.opencode`,
  ];
}

/**
 * Classify a SKILL.md location as project-local or user-global.
 *
 *  - Under a global home dir (~/.config/opencode, ~/.claude, ~/.agents, ~/.opencode) -> "global",
 *    unless the project itself lives inside that dir (e.g. editing the config repo) -> "local".
 *  - Inside the project dir -> "local".
 *  - Inside a `.opencode/.claude/.agents` dir of an *ancestor* of the project (monorepo root) -> "local".
 *  - Anything else -> "global".
 */
export function classifySkill(
  location: string,
  projectDir: string,
  homeDir: string,
): SkillScope {
  const loc = normalizePath(location);
  if (!loc) return "global";
  const project = normalizePath(projectDir);
  const home = normalizePath(homeDir);

  for (const dir of globalSkillDirs(home)) {
    if (!isInside(loc, dir)) continue;
    return project && isInside(project, dir) ? "local" : "global";
  }

  if (project && isInside(loc, project)) return "local";

  if (project) {
    const segs = loc.split("/");
    for (let i = 1; i < segs.length; i++) {
      if (!PROJECT_MARKERS.has(segs[i]!)) continue;
      const owner = segs.slice(0, i).join("/") || "/";
      if (owner === "/" || owner === home) continue;
      if (isInside(project, owner)) return "local";
    }
  }
  return "global";
}
