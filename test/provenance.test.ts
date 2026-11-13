import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProvenanceResolver,
  repositoryLabel,
  resolveCurrentSkills,
} from "../src/provenance";
import { buildGroups, displayGroups } from "../src/skills";
import { deriveUsage } from "../src/usage";

test("discards an older catalogue result after a newer catalogue is current", async () => {
  const old = [{ name: "old", location: "/old/SKILL.md", content: "" }];
  const current = [
    { name: "current", location: "/current/SKILL.md", content: "" },
  ];
  const pending = new Map<string, (skill: (typeof old)[number]) => void>();
  const resolve = (skill: (typeof old)[number]) =>
    new Promise<typeof skill>((done) => pending.set(skill.name, done));
  let currentCatalogue = old;
  const published: string[][] = [];
  const publish = (skills: typeof old) => {
    published.push(skills.map((skill) => skill.name));
  };
  const oldResult = resolveCurrentSkills(
    old,
    resolve,
    (items) => items === currentCatalogue,
    publish,
  );
  currentCatalogue = current;
  const currentResult = resolveCurrentSkills(
    current,
    resolve,
    (items) => items === currentCatalogue,
    publish,
  );
  pending.get("current")!(current[0]!);
  await currentResult;
  expect(published).toEqual([["current"]]);
  pending.get("old")!(old[0]!);
  await oldResult;
  expect(published).toEqual([["current"]]);
});

test("reads stripped author metadata from disk, then installation records and symlink Git origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "skill-provenance-"));
  try {
    const repo = join(root, "original");
    const installed = join(root, "installed");
    await mkdir(join(repo, "skills", "repo-skill"), { recursive: true });
    const init = Bun.spawn(["git", "init", "--quiet", repo], {
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await init.exited).toBe(0);
    await writeFile(
      join(repo, ".git", "config"),
      '[remote "origin"]\nurl = git@github.com:owner/original.git\n',
    );
    await mkdir(join(installed, "skills", "authored"), { recursive: true });
    await mkdir(join(installed, "skills", "locked"), { recursive: true });
    await writeFile(
      join(installed, "skills", "authored", "SKILL.md"),
      "---\nmetadata:\n  author: Alice\n---\nBody",
    );
    await writeFile(join(repo, "skills", "repo-skill", "SKILL.md"), "Body");
    await symlink(
      join(repo, "skills", "repo-skill"),
      join(installed, "skills", "linked"),
    );
    await writeFile(
      join(installed, ".skill-lock.json"),
      JSON.stringify({
        skills: {
          locked: { sourceType: "github", source: "upstream/skills" },
        },
      }),
    );
    const resolve = createProvenanceResolver();
    const skills = await Promise.all(
      ["authored", "locked", "linked", "missing"].map((name) =>
        resolve({
          name,
          location: join(installed, "skills", name, "SKILL.md"),
          content: "Body",
        }),
      ),
    );
    expect(
      skills.map(({ author, repository }) => ({ author, repository })),
    ).toEqual([
      { author: "Alice", repository: undefined },
      { author: undefined, repository: "upstream/skills" },
      { author: undefined, repository: "owner/original" },
      { author: undefined, repository: undefined },
    ]);
    const groups = buildGroups(skills, new Map(), {
      projectDir: root,
      homeDir: "/home",
    });
    expect(displayGroups(groups, "author").map((group) => group.title)).toEqual(
      ["Alice", "owner/original", "upstream/skills", "Unknown source"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository labels normalize transports and never expose credentials", () => {
  for (const url of [
    "https://github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo.git",
  ]) {
    expect(repositoryLabel(url)).toBe("owner/repo");
  }
  expect(
    repositoryLabel("https://secret:token@gitlab.com/owner/repo.git"),
  ).toBe("gitlab.com/owner/repo");
  expect(repositoryLabel("/local/path")).toBeUndefined();
});

test("native V2 skill messages and completed calls sort before unused skills", () => {
  const usage = deriveUsage([
    {
      type: "skill",
      skill: "native-id",
      name: "Native",
      time: { created: 20 },
    },
    {
      type: "assistant",
      content: [
        {
          type: "tool",
          name: "skill",
          state: {
            status: "completed",
            input: { id: "tool-id" },
          },
          time: { created: 10, completed: 30 },
        },
      ],
    },
  ]);
  const skills = ["native-id", "tool-id", "unused"].map((id) => ({
    id,
    name: id,
    content: "Body",
    location: "",
  }));
  const groups = buildGroups(skills, usage, {
    projectDir: "",
    homeDir: "/home",
  });
  expect(
    displayGroups(groups, "none").map((group) => ({
      title: group.title,
      names: group.rows.map((row) => row.name),
    })),
  ).toEqual([{ title: "", names: ["tool-id", "native-id", "unused"] }]);
});
