export interface SkillUsage {
  /** Skill name exactly as passed to the skill tool. */
  name: string;
  /** At least one invocation is pending/running right now. */
  active: boolean;
  /** Invoked since the latest successful compaction. */
  loaded: boolean;
  /** Latest finish time (ms) over completed/errored invocations. */
  lastUsed?: number;
}

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** Best-effort skill name from tool input. Pending v2 tool calls carry the raw (possibly partial) JSON string. */
export function skillNameFromInput(input: unknown): string | undefined {
  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return undefined;
    try {
      return skillNameFromInput(JSON.parse(s));
    } catch {
      // partial JSON while streaming: accept only a fully closed string value
      const m = /"(?:name|id|skill)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
      return m ? m[1]!.trim() || undefined : undefined;
    }
  }
  if (!isObj(input)) return undefined;
  const v = input.name ?? input.id ?? input.skill;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Finish time of a tool part, supporting v1 parts (state.time.end) and v2 content items (time.completed). */
function toolFinishTime(part: Obj, message?: Obj): number | undefined {
  const st = isObj(part.state) ? part.state : {};
  const stTime = isObj(st.time) ? st.time : {};
  const pTime = isObj(part.time) ? part.time : {};
  const mTime = isObj(message?.time) ? (message!.time as Obj) : {};
  return (
    num(stTime.end) ??
    num(stTime.start) ??
    num(pTime.completed) ??
    num(pTime.end) ??
    num(pTime.ran) ??
    num(pTime.start) ??
    num(pTime.created) ??
    num(mTime.completed) ??
    num(mTime.created)
  );
}

const isSkillTool = (part: unknown): part is Obj =>
  isObj(part) &&
  part.type === "tool" &&
  (part.tool === "skill" || part.name === "skill");

/** Parts of a message: v1 `parts` or v2 assistant `content`. */
function partsFor(message: unknown): readonly unknown[] {
  if (!isObj(message)) return [];
  if (Array.isArray(message.parts)) return message.parts;
  if (Array.isArray(message.content)) return message.content;
  return [];
}

function latestCompaction(messages: readonly unknown[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    if (
      !isObj(message) ||
      message.type !== "compaction" ||
      message.status !== "completed"
    )
      continue;
    const created = isObj(message.time) ? num(message.time.created) : undefined;
    if (created !== undefined) latest = Math.max(latest ?? created, created);
  }
  return latest;
}

function skillEntry(out: Map<string, SkillUsage>, name: string): SkillUsage {
  const key = name.trim().toLowerCase();
  const entry = out.get(key) ?? {
    name: name.trim(),
    active: false,
    loaded: false,
  };
  out.set(key, entry);
  return entry;
}

function recordSkillMessage(
  out: Map<string, SkillUsage>,
  message: Record<string, any>,
  compactedAt: number | undefined,
): void {
  const name = typeof message.skill === "string" ? message.skill : message.name;
  if (typeof name !== "string" || !name.trim()) return;
  const entry = skillEntry(out, name);
  const time = isObj(message.time) ? num(message.time.created) : undefined;
  entry.loaded ||=
    compactedAt === undefined || (time !== undefined && time > compactedAt);
  if (time !== undefined) entry.lastUsed = Math.max(entry.lastUsed ?? 0, time);
}

function recordToolPart(
  out: Map<string, SkillUsage>,
  part: unknown,
  message: unknown,
  compactedAt: number | undefined,
): void {
  if (!isSkillTool(part)) return;
  const state = isObj(part.state) ? part.state : {};
  const name = skillNameFromInput(state.input);
  if (!name) return;
  const entry = skillEntry(out, name);
  const time = toolFinishTime(part, isObj(message) ? message : undefined);
  const retained =
    compactedAt === undefined || (time !== undefined && time > compactedAt);
  entry.loaded ||= retained;
  if (
    state.status === "pending" ||
    state.status === "running" ||
    state.status === "streaming"
  ) {
    entry.active ||= retained;
  } else if (
    (state.status === "completed" || state.status === "error") &&
    time !== undefined
  ) {
    entry.lastUsed =
      entry.lastUsed === undefined ? time : Math.max(entry.lastUsed, time);
  }
}

/**
 * Walk a session's messages and fold every `skill` tool call into per-skill usage.
 * Keyed by lowercase skill name; `name` keeps the original spelling.
 */
export function deriveUsage(
  messages: readonly unknown[] | undefined,
): Map<string, SkillUsage> {
  const out = new Map<string, SkillUsage>();
  const sessionMessages = messages ?? [];
  const compactedAt = latestCompaction(sessionMessages);
  for (const message of sessionMessages) {
    if (isObj(message) && message.type === "skill") {
      recordSkillMessage(out, message, compactedAt);
    }
    for (const part of partsFor(message)) {
      recordToolPart(out, part, message, compactedAt);
    }
  }
  return out;
}
