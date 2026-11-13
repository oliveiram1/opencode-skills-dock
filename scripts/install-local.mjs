import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configDirectory = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "opencode",
);
const configFile = join(configDirectory, "cli.json");

execFileSync("bun", ["install", "--frozen-lockfile"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync("bun", ["run", "build"], { cwd: root, stdio: "inherit" });

const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : {};

if (!Array.isArray(config.plugins)) {
  if (config.plugins !== undefined) {
    throw new TypeError(`${configFile}: plugins must be an array`);
  }
  config.plugins = [];
}

if (!config.plugins.includes(root)) config.plugins.push(root);

mkdirSync(configDirectory, { recursive: true });
writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Built and added local plugin: ${root}`);
console.log(`OpenCode config: ${configFile}`);
console.log("Run /reload in OpenCode to load the plugin.");
