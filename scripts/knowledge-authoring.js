import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadAuthoringWorkspace, validateAuthoringWorkspace, compileRuntimeCollections, createRuntimeManifest } from "../src/knowledge/authoring.js";
import { renderCategoryPairPdf, renderTacticPlaybookPdf } from "../src/knowledge/authoring-pdf.js";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const directory = path.resolve(value("--input", "knowledge-authoring"));
const output = path.resolve(value("--out", path.join(directory, "generated")));
const compatibility = flag("--compat");

async function validate() {
  const workspace = await loadAuthoringWorkspace(directory);
  const result = validateAuthoringWorkspace(workspace, { compatibility });
  console.log(JSON.stringify({ ...result, model: undefined }, null, 2));
  return { workspace, result };
}

try {
  if (command === "validate") {
    const { result } = await validate(); process.exitCode = result.status === "PASS" ? 0 : 1;
  } else if (command === "compile") {
    const { result } = await validate();
    const report = await compileRuntimeCollections(result, output, { version: value("--version", "authoring-calibration"), releaseStatus: value("--release-status", "CALIBRATION_TEST_ONLY"), requireApproved: !flag("--allow-calibration") });
    console.log(JSON.stringify(report, null, 2));
  } else if (command === "render") {
    const { workspace, result } = await validate();
    if (result.status !== "PASS") throw new Error("Authoring validation must pass before rendering");
    await mkdir(output, { recursive: true });
    const antipatterns = new Map(workspace.antipatterns.map((item) => [item.document.id, item.document]));
    for (const capability of workspace.capabilities.map((item) => item.document)) await renderCategoryPairPdf(capability, antipatterns.get(`AP-${capability.id}`), path.join(output, `${capability.id}_AP-${capability.id}_Knowledge_Base_${capability.version}.pdf`));
    for (const catalog of workspace.tacticCatalogs.map((item) => item.document)) await renderTacticPlaybookPdf(catalog, path.join(output, `Governance_Tactic_Playbook_${catalog.version}.pdf`));
    console.log(`Rendered ${workspace.capabilities.length} category PDF(s) and ${workspace.tacticCatalogs.length} tactic playbook PDF(s) to ${output}`);
  } else if (command === "manifest") {
    const urlFile = value("--urls"); if (!urlFile) throw new Error("--urls is required");
    const urls = JSON.parse(await readFile(path.resolve(urlFile), "utf8"));
    const manifest = await createRuntimeManifest(directory, urls, { version: value("--version"), releaseStatus: value("--release-status") });
    console.log(JSON.stringify(manifest, null, 2));
  } else throw new Error("Usage: knowledge-authoring.js validate|compile|render|manifest --input <directory> [--out <directory>] [--compat] [--allow-calibration]");
} catch (error) { console.error(error.message); process.exitCode = 1; }
