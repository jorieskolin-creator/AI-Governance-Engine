import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const thisFile = fileURLToPath(import.meta.url);
const sourceRoots = ["src", "test", "scripts"];
const requiredFiles = ["public/index.html", "public/styles.css", "public/app.js", "railway.json", ".env.example"];
const forbiddenDomainTerms = [
  /finops_readiness/i,
  /crawl[\s_-]*walk[\s_-]*run/i,
  /maturity_ratio/i,
  /antipattern_burden/i
];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

for (const relativePath of requiredFiles) {
  if (!existsSync(join(projectRoot, relativePath))) {
    throw new Error(`Required project file is missing: ${relativePath}`);
  }
}

const files = sourceRoots.flatMap((root) => filesUnder(join(projectRoot, root)));
for (const file of files.filter((candidate) => extname(candidate) === ".js" && candidate !== thisFile)) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr);
    process.exit(checked.status ?? 1);
  }

  const source = readFileSync(file, "utf8");
  for (const term of forbiddenDomainTerms) {
    if (term.test(source)) throw new Error(`FinOps-domain semantic residue (${term}) found in ${file}`);
  }
}

console.log(`Source checks passed for ${files.length} files.`);
