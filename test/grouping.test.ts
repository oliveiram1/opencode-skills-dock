import { describe, expect, test } from "bun:test";
import {
  buildGroups,
  displayGroups,
  GROUPING_MODES,
  normalizeSkills,
  parseGroupingMode,
} from "../src/skills";
import { deriveUsage } from "../src/usage";

describe("author metadata", () => {
  test("reads catalogue fields and YAML frontmatter, with explicit metadata taking precedence", () => {
    const skills = normalizeSkills([
      { name: "direct", author: " Alice ", content: "---\nauthor: Bob\n---\n" },
      { name: "metadata", metadata: { author: "Vercel" } },
      {
        name: "yaml",
        content:
          '\uFEFF---\r\nmetadata:\r\n  author: "Clayton Kim" # attribution\r\n---\r\nBody',
      },
      {
        name: "top-level",
        content: "---\nauthor: >-\n  Alice Smith\n---\nBody",
      },
      { name: "missing", content: "Body\nauthor: Not metadata" },
      { name: "invalid", content: "---\nmetadata: [\n---\nBody" },
      { name: "blank", author: "  " },
      { name: "non-string", metadata: { author: ["Alice", "Bob"] } },
    ]);
    expect(skills.map((skill) => skill.author)).toEqual([
      "Alice",
      "Vercel",
      "Clayton Kim",
      "Alice Smith",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("sidebar grouping", () => {
  const skills = normalizeSkills([
    { name: "unused", location: "/project/unused/SKILL.md", author: "Alice" },
    {
      name: "finished",
      location: "/global/finished/SKILL.md",
      author: "alice",
      content: "xxxx",
    },
    {
      name: "running",
      location: "/global/running/SKILL.md",
      author: "Bob",
      content: "xxxx",
    },
    { name: "unknown", location: "/project/unknown/SKILL.md" },
  ]);
  const usage = deriveUsage([
    {
      parts: [
        {
          type: "tool",
          tool: "skill",
          state: { status: "running", input: { name: "running" } },
        },
        {
          type: "tool",
          tool: "skill",
          state: {
            status: "completed",
            input: { name: "finished" },
            time: { start: 1, end: 2 },
          },
        },
      ],
    },
  ]);
  const groups = buildGroups(skills, usage, {
    projectDir: "/project",
    homeDir: "/home",
    contextLimit: 100,
  });
  const view = (mode: "scope" | "author" | "none") =>
    displayGroups(groups, mode).map((group) => ({
      title: group.title,
      names: group.rows.map((row) => row.name),
    }));

  test("scope keeps local before global", () => {
    expect(view("scope")).toEqual([
      { title: "Local", names: ["unknown", "unused"] },
      { title: "Global", names: ["running", "finished"] },
    ]);
  });

  test("grouping modes omit status", () => {
    expect(GROUPING_MODES.map((mode) => mode.value)).toEqual([
      "none",
      "scope",
      "author",
    ]);
  });

  test("authors are alphabetical, case-insensitive, and unknown is last", () => {
    expect(view("author")).toEqual([
      { title: "alice", names: ["finished", "unused"] },
      { title: "Bob", names: ["running"] },
      { title: "Unknown source", names: ["unknown"] },
    ]);
  });

  test("switching modes preserves every skill, usage, and context totals", () => {
    for (const mode of ["scope", "author", "none"] as const) {
      const rows = displayGroups(groups, mode).flatMap((group) => group.rows);
      expect(rows.map((row) => row.name).sort()).toEqual(
        skills.map((skill) => skill.name).sort(),
      );
      expect(rows.find((row) => row.name === "finished")).toMatchObject({
        loaded: true,
        active: false,
        scope: "global",
      });
    }
    expect(groups).toMatchObject({
      total: 4,
      loaded: 2,
      active: 1,
      loadedTokens: 2,
      loadedPercent: 2,
    });
  });

  test("empty catalogues do not create empty headings", () => {
    const empty = buildGroups([], new Map(), {
      projectDir: "",
      homeDir: "/home",
    });
    for (const mode of ["scope", "author", "none"] as const)
      expect(displayGroups(empty, mode)).toEqual([]);
  });

  test("None can hide skills not loaded in this session", () => {
    expect(
      displayGroups(groups, "none", { hideInactive: true }).map((group) =>
        group.rows.map((row) => row.name),
      ),
    ).toEqual([["running", "finished"]]);
    expect(
      displayGroups(groups, "scope", { hideInactive: true }).flatMap((group) =>
        group.rows.map((row) => row.name),
      ),
    ).toHaveLength(4);
  });

  test("validates saved grouping preferences", () => {
    expect(parseGroupingMode("author")).toBe("author");
    expect(parseGroupingMode("scope")).toBe("scope");
    expect(parseGroupingMode("none")).toBe("none");
    expect(parseGroupingMode("status")).toBe("none");
    for (const value of [undefined, null, {}, "legacy"])
      expect(parseGroupingMode(value)).toBe("none");
  });
  test("None returns one flat list in usage order without a heading", () => {
    expect(view("none")).toEqual([
      { title: "", names: ["running", "finished", "unknown", "unused"] },
    ]);
  });
});
