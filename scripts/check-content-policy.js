import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { restrictedTokenMatches } from "../public/content-policy.js";

const projectRoot = resolve(import.meta.dirname, "..");
const textExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css", ".md", ".json", ".yml", ".yaml", ".toml", ".xml", ".txt", ".env"]);
const scanRoots = ["src", "public", "scripts", "test", "docs", ".github"];
const rootFiles = ["package.json", "pnpm-lock.yaml", "railway.json", ".env.example"];

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function trackedFiles() {
  if (process.env.CONTENT_POLICY_FORCE_FILESYSTEM !== "1") {
    const result = spawnSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8" });
    if (result.status === 0) return result.stdout.split("\0").filter(Boolean).map((item) => join(projectRoot, item));
  }

  process.stderr.write("Git metadata unavailable; scanning the project-owned filesystem allowlist.\n");
  return [
    ...scanRoots.flatMap((root) => filesUnder(join(projectRoot, root))),
    ...rootFiles.map((file) => join(projectRoot, file)).filter(existsSync)
  ];
}

async function extractText(file) {
  const extension = extname(file).toLowerCase();
  if (textExtensions.has(extension) || !extension) return readFileSync(file, "utf8");
  if (extension === ".docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: readFileSync(file) })).value;
  }
  if (extension === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, useWorkerFetch: false }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      pages.push((await page.getTextContent()).items.map((item) => item.str).join(" "));
    }
    return pages.join("\n");
  }
  return null;
}

const candidates = new Set([...trackedFiles(), ...scanRoots.flatMap((root) => filesUnder(join(projectRoot, root)))]);
const violations = [];
for (const file of candidates) {
  if (!existsSync(file)) continue;
  const content = await extractText(file);
  if (content === null) continue;
  const matches = restrictedTokenMatches(content);
  if (matches.length) violations.push({ file: file.slice(projectRoot.length + 1), count: matches.length });
}

if (violations.length) {
  for (const item of violations) process.stderr.write(`Restricted identifier policy violation: ${item.file} (${item.count} match(es))\n`);
  process.exit(1);
}

console.log(`Content policy checks passed for ${candidates.size} repository artifact(s).`);
