import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configDirectory = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "opencode",
);
const configFile = join(configDirectory, "cli.json");
const cacheDirectory = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  "opencode-skills-dock",
  "local",
);
const installedPackage = join(
  cacheDirectory,
  "node_modules",
  "opencode-skills-dock",
);

execFileSync("bun", ["install", "--frozen-lockfile"], {
  cwd: root,
  stdio: "inherit",
});

const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : {};

if (!Array.isArray(config.plugins)) {
  if (config.plugins !== undefined) {
    throw new TypeError(`${configFile}: plugins must be an array`);
  }
  config.plugins = [];
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "skills-dock-pack-"));

try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", temporaryDirectory],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  );
  const tarball = join(temporaryDirectory, packed[0].filename);

  mkdirSync(cacheDirectory, { recursive: true });
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      cacheDirectory,
      "--no-save",
      "--no-package-lock",
      "--ignore-scripts",
      tarball,
    ],
    { cwd: root, stdio: "inherit" },
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (!existsSync(join(installedPackage, "package.json"))) {
  throw new Error(`Package install did not create ${installedPackage}`);
}

config.plugins = config.plugins.filter((plugin) => plugin !== root);
if (!config.plugins.includes(installedPackage)) {
  config.plugins.push(installedPackage);
}

mkdirSync(configDirectory, { recursive: true });
writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Installed packed plugin: ${installedPackage}`);
console.log(`OpenCode config: ${configFile}`);
console.log("Run /reload in OpenCode to load the plugin.");
