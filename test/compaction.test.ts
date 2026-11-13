import { expect, test } from "bun:test";
import { deriveUsage } from "../src/usage";
import { buildGroups, displayGroups, GROUPING_MODES } from "../src/skills";

const skill = (id: string, created: number) => ({
  type: "skill",
  skill: id,
  time: { created },
});
const compaction = (status: string, created: number) => ({
  type: "compaction",
  status,
  time: { created },
});
const catalogue = ["old", "new"].map((name) => ({
  name,
  location: "",
  content: "Instructions",
}));
const groups = (messages: unknown[]) =>
  buildGroups(catalogue, deriveUsage(messages), {
    projectDir: "",
    homeDir: "/home",
    contextLimit: 1000,
  });

test("completed compaction clears loaded skills and estimates but keeps history", () => {
  const messages = [skill("old", 10), compaction("completed", 20)];
  expect(groups(messages)).toMatchObject({
    loaded: 0,
    active: 0,
    loadedTokens: 0,
  });
  expect(groups(messages).loadedPercent).toBeUndefined();
  expect(deriveUsage(messages).get("old")).toMatchObject({
    lastUsed: 10,
  });
});

test("only loads after the latest successful compaction count, regardless of message order", () => {
  const messages = [
    skill("old", 10),
    compaction("completed", 20),
    skill("old", 30),
    compaction("completed", 40),
    skill("new", 50),
  ];
  for (const ordered of [messages, [...messages].reverse()]) {
    const result = groups(ordered);
    expect(result.loaded).toBe(1);
    expect(
      result.global
        .concat(result.local)
        .filter((row) => row.loaded)
        .map((row) => row.name),
    ).toEqual(["new"]);
    expect(result.loadedTokens).toBe(3);
    expect(result.loadedPercent).toBeCloseTo(0.3);
  }
});

test("running or failed compaction does not clear loaded skills", () => {
  for (const status of ["running", "failed"]) {
    expect(groups([skill("old", 10), compaction(status, 20)]).loaded).toBe(1);
  }
});

test("compacted skills return to name order across grouping modes", () => {
  const messages = [
    skill("new", 10),
    skill("old", 20),
    compaction("completed", 30),
  ];
  for (const { value } of GROUPING_MODES) {
    expect(
      displayGroups(groups(messages), value).flatMap((group) =>
        group.rows.map((row) => row.name),
      ),
    ).toEqual(["new", "old"]);
  }
  expect(
    displayGroups(groups([...messages, skill("old", 40)]), "none")[0]?.rows.map(
      (row) => row.name,
    ),
  ).toEqual(["old", "new"]);
});

test("compaction clears old running tool state and permits a later tool reload", () => {
  const tool = (created: number) => ({
    type: "assistant",
    time: { created },
    content: [
      {
        type: "tool",
        name: "skill",
        state: { status: "running", input: { id: "old" } },
      },
    ],
  });
  expect(groups([tool(10), compaction("completed", 20)])).toMatchObject({
    loaded: 0,
    active: 0,
  });
  expect(
    groups([tool(10), compaction("completed", 20), tool(30)]),
  ).toMatchObject({ loaded: 1, active: 1 });
});
