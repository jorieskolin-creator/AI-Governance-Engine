import { knowledgeManifestView, loadKnowledgeSnapshot } from "../src/knowledge/provider.js";

const manifestUrl = process.argv[2] ?? process.env.VERCEL_KB_MANIFEST_URL;
if (!manifestUrl) throw new Error("VERCEL_KB_MANIFEST_URL is required");

let parsed;
try { parsed = new URL(manifestUrl); }
catch { throw new Error("VERCEL_KB_MANIFEST_URL must be an absolute URL"); }
if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("VERCEL_KB_MANIFEST_URL must be a credential-free HTTPS URL");

const snapshot = await loadKnowledgeSnapshot({ manifestUrl, production: true });
if (snapshot.releaseStatus !== "APPROVED") throw new Error(`Knowledge release is not approved: ${snapshot.releaseStatus}`);
if (snapshot.diagnostics?.status !== "PASS") throw new Error(`Knowledge diagnostics did not pass: ${snapshot.diagnostics?.status ?? "UNKNOWN"}`);

process.stdout.write(`${JSON.stringify(knowledgeManifestView(snapshot), null, 2)}\n`);
