import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "skills-dock-package-"));

function run(command, args, cwd, inherit = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    env: { ...process.env, SKILLS_DOCK_TEST_ENTRY: "opencode-skills-dock/tui" },
  });
}

try {
  const [{ filename }] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", directory], root),
  );
  writeFileSync(
    join(directory, "package.json"),
    '{"private":true,"type":"module"}',
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(directory, filename),
    ],
    directory,
  );
  run(
    process.execPath,
    [
      "--conditions=browser",
      "-e",
      `
    const { default: plugin } = await import("opencode-skills-dock/tui");
    if (typeof plugin.setup !== "function") throw new Error("Missing TUI setup export");
  `,
    ],
    directory,
  );
  console.log(
    "Packed TUI entry point imports successfully outside the checkout.",
  );
  copyFileSync(
    join(root, "test/sidebar.test.ts"),
    join(directory, "sidebar.test.ts"),
  );
  run(
    process.execPath,
    ["--conditions=browser", "test", "./sidebar.test.ts"],
    directory,
    true,
  );
} catch (error) {
  console.error(error.message);
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
