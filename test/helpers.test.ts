import { describe, expect, test } from "bun:test";
import { classifySkill } from "../src/classify";
import {
  estimateSkillPercent,
  estimateTokens,
  formatPercent,
  formatTokenSummary,
} from "../src/estimate";
import { deriveUsage, skillNameFromInput } from "../src/usage";
import { contextLimitFor, lastAssistantModel } from "../src/context";
import { buildGroups, normalizeSkills } from "../src/skills";

const HOME = "/Users/me";
const PROJECT = "/Users/me/code/app";

describe("classifySkill", () => {
  const c = (loc: string, project = PROJECT, home = HOME) =>
    classifySkill(loc, project, home);
  test("inside project is local", () => {
    expect(c(`${PROJECT}/.opencode/skills/a/SKILL.md`)).toBe("local");
    expect(c(`${PROJECT}/.claude/skills/a/SKILL.md`)).toBe("local");
    expect(c(`${PROJECT}/.agents/skills/a/SKILL.md`)).toBe("local");
    expect(c(`${PROJECT}/docs/skills/a/SKILL.md`)).toBe("local");
  });
  test("home config dirs are global", () => {
    expect(c(`${HOME}/.config/opencode/skills/a/SKILL.md`)).toBe("global");
    expect(c(`${HOME}/.claude/skills/a/SKILL.md`)).toBe("global");
    expect(c(`${HOME}/.agents/skills/a/SKILL.md`)).toBe("global");
    expect(c(`${HOME}/.opencode/skills/a/SKILL.md`)).toBe("global");
  });
  test("anything else is global", () => {
    expect(c("/opt/shared/skills/a/SKILL.md")).toBe("global");
    expect(c("")).toBe("global");
  });
  test("project == home: home config dirs stay global", () => {
    expect(c(`${HOME}/.claude/skills/a/SKILL.md`, HOME)).toBe("global");
    expect(c(`${HOME}/.config/opencode/skills/a/SKILL.md`, HOME)).toBe(
      "global",
    );
  });
  test("project inside a global dir is local", () => {
    expect(
      c(
        `${HOME}/.config/opencode/skills/a/SKILL.md`,
        `${HOME}/.config/opencode`,
      ),
    ).toBe("local");
  });
  test("monorepo ancestor .opencode counts as local", () => {
    expect(
      c(
        "/Users/me/code/mono/.opencode/skills/a/SKILL.md",
        "/Users/me/code/mono/packages/x",
      ),
    ).toBe("local");
    expect(
      c(
        "/Users/me/code/other/.opencode/skills/a/SKILL.md",
        "/Users/me/code/mono/packages/x",
      ),
    ).toBe("global");
  });
  test("no prefix confusion and trailing slashes / backslashes", () => {
    expect(c("/Users/me/code/app-two/.opencode/skills/a/SKILL.md")).toBe(
      "global",
    );
    expect(c(`${PROJECT}/x/SKILL.md`, PROJECT + "/")).toBe("local");
    expect(c("\\Users\\me\\code\\app\\x\\SKILL.md")).toBe("local");
  });
});

describe("estimateSkillPercent", () => {
  test("tokens = ceil(chars/4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
  test("percent of limit", () => {
    expect(estimateSkillPercent("x".repeat(4000), 200_000)).toBeCloseTo(0.5);
    expect(formatPercent(estimateSkillPercent("x".repeat(4000), 200_000))).toBe(
      "~0.5%",
    );
    expect(
      formatPercent(estimateSkillPercent("x".repeat(40_000), 200_000)),
    ).toBe("~5.0%");
  });
  test("tiny and unknown", () => {
    expect(formatPercent(estimateSkillPercent("hello", 200_000))).toBe("<0.1%");
    expect(estimateSkillPercent("hello", undefined)).toBeUndefined();
    expect(estimateSkillPercent("hello", 0)).toBeUndefined();
    expect(formatPercent(undefined)).toBeUndefined();
  });
  test("formats the total with an optional context share", () => {
    expect(formatTokenSummary(42_000, 1)).toBe("42K tokens ~1.0%");
    expect(formatTokenSummary(1250, undefined)).toBe("1.3K tokens");
    expect(formatTokenSummary(42, 0.01)).toBe("42 tokens <0.1%");
  });
});

const v1Part = (
  status: string,
  name: string | undefined,
  time?: { start: number; end?: number },
) => ({
  type: "tool",
  tool: "skill",
  state: { status, input: name ? { name } : {}, ...(time ? { time } : {}) },
});
const v2Item = (
  status: string,
  input: unknown,
  time: { created: number; ran?: number; completed?: number },
) => ({
  type: "tool",
  name: "skill",
  state: { status, input },
  time,
});

describe("deriveUsage", () => {
  test("v1 parts: running is active and completed retains the latest finish", () => {
    const msgs = [
      {
        parts: [
          v1Part("completed", "brainstorming", { start: 100, end: 150 }),
          { type: "text", text: "hi" },
        ],
      },
      {
        parts: [
          v1Part("running", "debugging", { start: 300 }),
          v1Part("completed", "brainstorming", { start: 400, end: 450 }),
        ],
      },
    ];
    const u = deriveUsage(msgs);
    expect(u.get("brainstorming")).toMatchObject({
      active: false,
      lastUsed: 450,
    });
    expect(u.get("debugging")).toMatchObject({ active: true, loaded: true });
    expect(u.get("debugging")!.lastUsed).toBeUndefined();
  });
  test("pending with empty name is ignored; pending with name is active", () => {
    const u = deriveUsage([
      { parts: [v1Part("pending", undefined), v1Part("pending", "a")] },
    ]);
    expect([...u.keys()]).toEqual(["a"]);
    expect(u.get("a")!.active).toBe(true);
  });
  test("error counts as used/idle; falls back to state.time.start", () => {
    const u = deriveUsage([{ parts: [v1Part("error", "a", { start: 42 })] }]);
    expect(u.get("a")).toMatchObject({ active: false, lastUsed: 42 });
  });
  test("a skill that finished earlier but is running again stays active and keeps lastUsed", () => {
    const u = deriveUsage([
      {
        parts: [
          v1Part("completed", "a", { start: 1, end: 5 }),
          v1Part("running", "a", { start: 9 }),
        ],
      },
    ]);
    expect(u.get("a")).toMatchObject({ active: true, lastUsed: 5 });
  });
  test("v2 assistant content items (name, time.completed, pending string input)", () => {
    const u = deriveUsage([
      {
        type: "assistant",
        time: { created: 1 },
        content: [
          v2Item(
            "completed",
            { name: "writing" },
            { created: 10, completed: 20 },
          ),
          v2Item("pending", '{"name":"tdd"', { created: 30 }),
          v2Item("pending", '{"na', { created: 31 }),
          v2Item("running", { name: "Debugging" }, { created: 40, ran: 41 }),
        ],
      },
      { type: "user" },
    ]);
    expect(u.get("writing")).toMatchObject({ active: false, lastUsed: 20 });
    expect(u.get("tdd")).toMatchObject({ active: true });
    expect(u.get("debugging")).toMatchObject({
      active: true,
      name: "Debugging",
    });
    expect(u.size).toBe(3);
  });
  test("non-skill tools and junk are ignored", () => {
    const u = deriveUsage([
      null,
      3,
      {
        parts: [
          {
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { name: "x" } },
          },
          null,
        ],
      },
    ]);
    expect(u.size).toBe(0);
    expect(deriveUsage(undefined).size).toBe(0);
  });
  test("v2 streaming status is active once the name is known; `id` input key is accepted", () => {
    const u = deriveUsage([
      {
        type: "assistant",
        content: [
          v2Item("streaming", "", { created: 1 }),
          v2Item("streaming", '{"id":"tdd"}', { created: 2 }),
          v2Item("completed", { id: "writing" }, { created: 3, completed: 9 }),
        ],
      },
    ]);
    expect([...u.keys()].sort()).toEqual(["tdd", "writing"]);
    expect(u.get("tdd")!.active).toBe(true);
    expect(u.get("writing")).toMatchObject({ active: false, lastUsed: 9 });
  });
  test("skillNameFromInput", () => {
    expect(skillNameFromInput({ name: " a " })).toBe("a");
    expect(skillNameFromInput('{"name":"b"}')).toBe("b");
    expect(skillNameFromInput('{"name":"b')).toBeUndefined();
    expect(skillNameFromInput(undefined)).toBeUndefined();
  });
});

describe("context limit", () => {
  const models = [
    { providerID: "anthropic", id: "claude", limit: { context: 200_000 } },
    { providerID: "other", id: "claude", limit: { context: 1_000 } },
  ];
  test("last assistant model -> limit", () => {
    const msgs = [
      { type: "assistant", model: { providerID: "other", id: "claude" } },
      { type: "user" },
      { type: "assistant", model: { providerID: "anthropic", id: "claude" } },
      { type: "user" },
    ];
    const ref = lastAssistantModel(msgs);
    expect(ref).toEqual({ providerID: "anthropic", modelID: "claude" });
    expect(contextLimitFor(ref, models)).toBe(200_000);
  });
  test("v1 shaped messages and unknowns", () => {
    expect(
      lastAssistantModel([
        { role: "assistant", providerID: "p", modelID: "m" },
      ]),
    ).toEqual({ providerID: "p", modelID: "m" });
    expect(lastAssistantModel([{ type: "user" }])).toBeUndefined();
    expect(
      contextLimitFor({ providerID: "x", modelID: "nope" }, models),
    ).toBeUndefined();
    expect(contextLimitFor(undefined, models)).toBeUndefined();
  });
});

describe("buildGroups", () => {
  const skills = normalizeSkills([
    {
      id: "g1",
      name: "g1",
      path: `${HOME}/.claude/skills/g1/SKILL.md`,
      content: "x".repeat(4000),
    },
    {
      name: "l1",
      location: `${PROJECT}/.opencode/skills/l1/SKILL.md`,
      content: "y".repeat(8000),
    },
    {
      name: "l2",
      location: `${PROJECT}/.opencode/skills/l2/SKILL.md`,
      content: "z",
    },
    { name: "l1", location: "dup" },
    null,
    {},
  ]);
  test("normalize drops dupes/junk and maps path->location", () => {
    expect(skills.map((s) => s.name)).toEqual(["g1", "l1", "l2"]);
    expect(skills[0]!.location).toContain(".claude");
  });
  test("grouping, counts, percentages", () => {
    const usage = deriveUsage([
      {
        parts: [
          v1Part("completed", "g1", { start: 1, end: 2 }),
          v1Part("running", "l1", { start: 3 }),
        ],
      },
    ]);
    const g = buildGroups(skills, usage, {
      projectDir: PROJECT,
      homeDir: HOME,
      contextLimit: 200_000,
    });
    expect(g.global.map((r) => r.name)).toEqual(["g1"]);
    expect(g.local.map((r) => r.name)).toEqual(["l1", "l2"]); // active first
    expect(g).toMatchObject({ total: 3, loaded: 2, active: 1 });
    expect(g.loadedTokens).toBe(3000);
    expect(g.loadedPercent).toBeCloseTo(1.5);
  });
  test("unknown limit hides percentages", () => {
    const usage = deriveUsage([
      { parts: [v1Part("completed", "g1", { start: 1, end: 2 })] },
    ]);
    const g = buildGroups(skills, usage, {
      projectDir: PROJECT,
      homeDir: HOME,
    });
    expect(g.loadedTokens).toBe(1000);
    expect(g.loadedPercent).toBeUndefined();
  });
  test("sorts active first, then loaded skills by most recent use within each group", () => {
    const catalogue = normalizeSkills(
      ["alpha", "beta", "gamma", "running", "unused"].map((name) => ({
        name,
        location: `${PROJECT}/.opencode/skills/${name}/SKILL.md`,
        content: "x",
      })),
    );
    const usage = deriveUsage([
      {
        parts: [
          v1Part("completed", "alpha", { start: 1, end: 2 }),
          v1Part("completed", "beta", { start: 3, end: 4 }),
          v1Part("completed", "gamma", { start: 5, end: 6 }),
          v1Part("running", "running", { start: 1 }),
        ],
      },
    ]);
    const g = buildGroups(catalogue, usage, {
      projectDir: PROJECT,
      homeDir: HOME,
    });
    expect(g.local.map((row) => row.name)).toEqual([
      "running",
      "gamma",
      "beta",
      "alpha",
      "unused",
    ]);
  });
});
