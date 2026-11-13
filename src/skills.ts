import { classifySkill, type SkillScope } from "./classify";
import { YAML } from "bun";
import { estimateTokens } from "./estimate";
import type { SkillUsage } from "./usage";

export interface SkillInfo {
  name: string;
  id?: string;
  description?: string;
  /** Absolute path of SKILL.md (SDK: `location`, 2.2.0 data store: `path`). */
  location: string;
  content: string;
  author?: string;
  repository?: string;
}

function authorFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return;
  if (
    "author" in value &&
    typeof value.author === "string" &&
    value.author.trim()
  )
    return value.author.trim();
  if ("metadata" in value) return authorFrom(value.metadata);
}

export function frontmatterAuthor(content: string): string | undefined {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    content,
  );
  if (!frontmatter) return;
  try {
    return authorFrom(YAML.parse(frontmatter[1] ?? ""));
  } catch {
    return;
  }
}

/** Accepts SDK `SkillV2Info` ({location}) and 2.2.0 store entries ({id, path}). Drops unusable entries. */
export function normalizeSkills(
  raw: readonly unknown[] | undefined,
): SkillInfo[] {
  const out: SkillInfo[] = [];
  const seen = new Set<string>();
  for (const r of raw ?? []) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, any>;
    const name =
      typeof o.name === "string" && o.name
        ? o.name
        : typeof o.id === "string"
          ? o.id
          : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name,
      id: typeof o.id === "string" ? o.id : undefined,
      description:
        typeof o.description === "string" ? o.description : undefined,
      location:
        typeof o.location === "string"
          ? o.location
          : typeof o.path === "string"
            ? o.path
            : "",
      content: typeof o.content === "string" ? o.content : "",
      author:
        authorFrom(r) ??
        frontmatterAuthor(typeof o.content === "string" ? o.content : ""),
    });
  }
  return out;
}

export interface SkillRow {
  name: string;
  author?: string;
  repository?: string;
  scope: SkillScope;
  active: boolean;
  /** Loaded (invoked) in this session: running or has a finished invocation. */
  loaded: boolean;
  lastUsed?: number;
}

export interface SkillGroups {
  global: SkillRow[];
  local: SkillRow[];
  total: number;
  loaded: number;
  active: number;
  loadedTokens: number;
  /** Sum of loaded skills' estimated context share (percent); undefined if limit unknown / nothing loaded. */
  loadedPercent?: number;
}

const byRow = (a: SkillRow, b: SkillRow) =>
  Number(b.active) - Number(a.active) ||
  Number(b.loaded) - Number(a.loaded) ||
  (a.loaded && b.loaded ? (b.lastUsed ?? 0) - (a.lastUsed ?? 0) : 0) ||
  a.name.localeCompare(b.name);

/** Join the skill catalogue with session usage into Global/Local groups (pure). */
export function buildGroups(
  skills: readonly SkillInfo[],
  usage: ReadonlyMap<string, SkillUsage>,
  opts: { projectDir: string; homeDir: string; contextLimit?: number },
): SkillGroups {
  const groups: SkillGroups = {
    global: [],
    local: [],
    total: 0,
    loaded: 0,
    active: 0,
    loadedTokens: 0,
  };
  for (const s of skills) {
    const u =
      usage.get(s.name.toLowerCase()) ??
      (s.id ? usage.get(s.id.toLowerCase()) : undefined);
    const active = !!u?.active;
    const loaded = !!u?.loaded;
    const scope = classifySkill(s.location, opts.projectDir, opts.homeDir);
    const row: SkillRow = {
      name: s.name,
      author: s.author,
      repository: s.repository,
      scope,
      active,
      loaded,
      lastUsed: u?.lastUsed,
    };
    groups[scope].push(row);
    groups.total++;
    if (loaded) {
      groups.loaded++;
      groups.loadedTokens += estimateTokens(s.content);
    }
    if (active) groups.active++;
  }
  groups.global.sort(byRow);
  groups.local.sort(byRow);
  if (
    groups.loaded > 0 &&
    opts.contextLimit &&
    Number.isFinite(opts.contextLimit) &&
    opts.contextLimit > 0
  ) {
    groups.loadedPercent = (groups.loadedTokens / opts.contextLimit) * 100;
  }
  return groups;
}

export const GROUPING_MODES = [
  { value: "none", title: "None" },
  { value: "scope", title: "Scope" },
  { value: "author", title: "Author" },
] as const;

export type GroupingMode = (typeof GROUPING_MODES)[number]["value"];

export function parseGroupingMode(value: unknown): GroupingMode {
  return GROUPING_MODES.find((mode) => mode.value === value)?.value ?? "none";
}

export interface DisplayGroup {
  key: string;
  title: string;
  rows: SkillRow[];
}

/** Regroup without changing session totals, scope, or usage ordering. */
export function displayGroups(
  groups: SkillGroups,
  mode: GroupingMode,
  options: { hideInactive?: boolean } = {},
): DisplayGroup[] {
  if (mode === "scope")
    return [
      { key: "scope:local", title: "Local", rows: groups.local },
      { key: "scope:global", title: "Global", rows: groups.global },
    ].filter((group) => group.rows.length > 0);

  const rows = [...groups.local, ...groups.global]
    .filter((row) => mode !== "none" || !options.hideInactive || row.loaded)
    .sort(byRow);
  if (mode === "none")
    return rows.length ? [{ key: "none", title: "", rows }] : [];
  const authors = new Map<string, DisplayGroup>();
  for (const row of rows) {
    const title = row.author ?? row.repository ?? "Unknown source";
    const key = row.author
      ? `author:${row.author.toLowerCase()}`
      : row.repository
        ? `repo:${row.repository.toLowerCase()}`
        : "author:unknown:";
    const group = authors.get(key) ?? { key, title, rows: [] };
    group.rows.push(row);
    authors.set(key, group);
  }
  return [...authors.values()].sort(
    (a, b) =>
      Number(a.key === "author:unknown:") -
        Number(b.key === "author:unknown:") || a.title.localeCompare(b.title),
  );
}
