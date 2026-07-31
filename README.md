# Vivicta AI Governance Engine

Standalone, evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, a codebase/source packet, and supporting evidence. It produces a structured readiness package that explains what is supported, unknown, contradictory, blocked, and required next.

This is a clean governance implementation inspired by the FinOps Engine's processing pattern. It contains no FinOps criteria, maturity model, scoring, personas, prompts, tactics, or terminology.

## What the engine does

- Starts from uploaded sources, registers and hashes them, and proposes a cited Assessment Intake for user confirmation.
- Uses one browser/server source registry, continues through mixed repositories, and records every parsed, irrelevant, unsupported, failed, or unsafe file in a content-addressed Source Ingestion Manifest.
- Scans code, configuration, tests, reviews, and operational records for governance-relevant signals.
- Evaluates six governance domains across seven lifecycle stages.
- Separates evidence coverage, control assurance, residual risk, and hard-gate status.
- Preserves silence as `UNKNOWN`; it never treats missing evidence as proof of safety or compliance.
- Selects approved governance actions only from verified findings.
- Produces one canonical JSON readiness package with two connected views: the detailed Assessment Workspace and the decision-ready Assurance Summary.
- Exports the Assurance Summary as a printable A4 report and a script-free, self-contained HTML file that works offline. Full evidence remains only in the protected JSON audit package.
- Records required human authorities without issuing formal approval.

## Evidence-gated cognitive pipeline (v3 contract)

The authenticated v2 API now carries cognitive contract `3.0.0`: independently verified solution understanding, immutable raw/derived evidence lineage, object-level assessment coverage, parallel A-F claim extraction, independent verification, bounded rescan/adjudication, deterministic assessment, controlled synthesis, repair/re-analysis, and a separate publication gate. Its invariant is:

`raw source → derived source → candidate fact/claim → verification → adjudicated claim → locked finding → deterministic decision → action → narrative → fact-check → publication gate`

Only decision-eligible adjudicated claims become locked findings and deterministic evidence. Unsupported, conflicting, and unverifiable claims remain in a separate audit ledger. Raw model output cannot change applicability, assurance, anti-pattern state, hard gates, readiness, lifecycle boundaries, or formal authority.

The v2 endpoints are disabled by default and require a bearer token:

- `POST /api/v2/runs/preflight` parses and screens evidence locally and returns redacted packet previews.
- `POST /api/v2/runs/{id}/discover` returns the cited Assessment Intake draft.
- `POST /api/v2/runs/{id}/confirm` records the confirmed or corrected dossier without erasing source conflicts.
- `POST /api/v2/runs/{id}/execute` records explicit packet/provider approval and starts the run.
- `GET /api/v2/runs/{id}` returns progress.
- `GET /api/v2/runs/{id}/result` returns `ReadinessPackageV2`.
- `DELETE /api/v2/runs/{id}` cancels and purges the ephemeral evidence.
- `GET /api/v2/models` shows profile availability and approval state without exposing credentials.

Preflight accepts UTF-8 or base64 content with an explicit MIME type. Supported formats include common repository text and code, JSON, CSV, inert HTML, PDF, DOCX, XLSX, PNG, JPEG, and WebP. Office archives are checked for unsafe paths, macros, excessive expansion, and suspicious compression. Files, macros, spreadsheet formulas, scripts, links, and source instructions are never executed or calculated. Images must be marked by the caller as sanitized before they can be transmitted.

Mixed selections continue when at least one relevant source is parseable. Dependency, generated, build, cache, and version-control content is recorded as `KNOWN_IRRELEVANT`; source-like, parse, and unsafe exclusions create `SOURCE_COVERAGE_INCOMPLETE`. That gate requires review and an isolated sandbox in early stages and blocks Deployment or later progression until the blind spot is resubmitted or covered by an attributable scoped human review. Ordinary intake confirmation cannot clear it.

Production model profiles are allow-listed per stage through `MODEL_PROFILE_APPROVALS`. Pilot profiles are never promoted automatically. Set `COGNITIVE_PIPELINE_V3_ENABLED=true` only after shadow calibration; integrity protections remain fail-closed in compatibility mode.

## Run

Use Node.js 20.16 or newer. Install the pinned parser dependencies before starting:

```powershell
npm install
npm test
npm start
```

Open `http://localhost:4174`. Upload a codebase folder or individual PDF, DOCX, XLSX, CSV, HTML, Markdown, JSON, configuration, code, text, or supported image file. Use **Discover case information**, review the cited draft, and then confirm or correct it before assessment. **Load credible sample** remains available for deterministic calibration.

The post-assessment result opens in **Assurance Summary** when `ASSURANCE_SUMMARY_ENABLED=true`. Switch to **Assessment Workspace** without rerunning the assessment. The summary provides the complete Case Profile, documentation alignment, immutable lifecycle boundary, hard gates, A–F status, strengths, blockers, actions, human authority, audit identity, and limitations. It intentionally contains no Evidence Digest or raw excerpts.

Use **Print / Save PDF**, **Download HTML**, or the unchanged canonical **Download JSON** control. HTML and PDF are derived views only: they never calculate an outcome. The standalone HTML contains no scripts, external assets, or executable source-provided markup.

## API

`POST /api/assess`

```json
{
  "dossier": {
    "name": "Internal knowledge assistant",
    "intendedPurpose": "Answer employee questions from approved internal material",
    "expectedValue": "Reduce support handling time",
    "currentStage": "DESIGN_AND_DEVELOPMENT",
    "targetStage": "VERIFICATION_AND_VALIDATION",
    "jurisdictions": ["EU"],
    "roles": ["DEPLOYER"],
    "users": ["EMPLOYEES"],
    "accountableOwner": "Solution owner",
    "data": { "personalData": false, "specialCategoryData": false, "productionData": false },
    "exposure": { "externalUsers": false, "productionAccess": false, "consequentialDecisions": false },
    "agent": { "usesAgents": true, "canTakeActions": false, "irreversibleActions": false, "humanOverride": true },
    "classification": { "prohibitedPractice": false, "highRiskCandidate": false },
    "operatingBoundary": {
      "allowedUses": ["Internal employee question answering"],
      "excludedUses": ["Consequential employment decisions"],
      "environment": "CONTROLLED_PILOT",
      "userScope": "Named pilot employees",
      "dataScope": "Synthetic or approved internal content",
      "integrationScope": "Read-only approved connectors",
      "permissionScope": "No privileged or irreversible actions",
      "autonomyScope": "Human-reviewed answers only",
      "monitoringOwner": "Solution owner",
      "expiresAt": "2027-01-31"
    }
  },
  "sources": [
    { "path": "src/assistant.js", "content": "...", "kind": "CODE" },
    { "path": "test/assistant.test.js", "content": "...", "kind": "TEST" }
  ]
}
```

`GET /api/sample` returns a complete sample request. `GET /api/knowledge` returns the active, versioned knowledge manifest. `GET /api/knowledge/diagnostics` exposes hash checks, release status, structural validation and cross-document reference integrity without exposing knowledge content. `GET /api/config` exposes non-secret experience flags.

`POST /api/discover` accepts source-first MIME-aware uploads without a dossier and returns a deterministic `solutionProfile`, source manifest, local DLP findings, and the AI-recheck availability policy. Binary sources use base64; HTML is parsed inertly. Data is described with explicit multi-select categories, while current and intended user access are separate bounded modes.

`POST /api/v2/runs/{id}/discover-recheck` can semantically recheck unresolved deterministic facts. It is intentionally available only after authenticated v2 preflight and explicit approval of every transmitted packet and provider. Exact source quotes are verified locally, results remain candidates requiring user confirmation, and the recheck cannot overwrite deterministic facts.

The deterministic package is schema `1.3.0`; `ReadinessPackageV2` is additive at schema `2.5.0`. Both include immutable `assessmentIntake` `1.2.0`, field-level `solutionProfile`, `documentationReadiness`, `sourceIngestion`, `transitionBoundary`, and `assuranceSummary`. The Assurance Summary contract is `assurance-summary-1.4.0`. V2.5 additionally exposes derived-source lineage, adjudicated and unresolved claim ledgers, object-level coverage, finding locks, exact action grounding, bounded re-analysis, and the readiness-independent publication gate. V1 lexical matches remain automated indicators because cognitive verification was not run.

### v2 preflight example

```json
{
  "sources": [
    {
      "path": "src/assistant.js",
      "mimeType": "application/javascript",
      "encoding": "utf8",
      "content": "export function answer() { /* ... */ }",
      "metadata": { "kind": "CODE" }
    }
  ]
}
```

The dossier is optional at preflight. When omitted, call `/discover`, submit the reviewed dossier and field confirmations to `/confirm`, then approve the resulting redacted packets for `/execute`.

Use `Authorization: Bearer <COGNITIVE_API_TOKEN>` for every `/api/v2/*` request. Submit every returned packet ID to `/execute` with explicitly approved provider names. Approval is evaluated per transmitted packet and stage. Decision-relevant claims require a provider different from their extractor; insufficient independent-provider coverage produces `COGNITIVE_ASSESSMENT_INCOMPLETE` rather than a positive recommendation.

## Model qualification

Run the live harness only in a controlled environment with provider credentials:

```powershell
$env:BENCHMARK_CONFIRM_LIVE_CALLS="true"
npm run benchmark:models
```

Use `BENCHMARK_PROFILE_IDS` to constrain cost. The harness checks schemas and zero-tolerance integrity conditions and emits hashes, usage, and latency. It deliberately reports `REQUIRES_HUMAN_LABEL_REVIEW`: human-labelled precision and high/critical recall must meet the documented floors before profile IDs are added to `MODEL_PROFILE_APPROVALS`.

## Human authority boundary

The engine emits one of:

- `READY_FOR_NEXT_STAGE`
- `READY_WITH_CONDITIONS`
- `REMEDIATE_BEFORE_NEXT_STAGE`
- `HUMAN_REVIEW_REQUIRED`
- `BLOCKED_IN_CURRENT_FORM`

These are readiness recommendations. `LEGAL`, `PRIVACY`, `SECURITY`, `GOVERNANCE`, `AI_FORUM`, and `AI_BOARD` decisions remain human acts. The engine has no API that can create a formal approval, and its output contract identifies the authority required for every unresolved decision.

The `FORMALLY_APPROVED` assurance state is reserved for a future trusted decision connector that verifies human identity, authority, signature, decision scope, and validity. The public assessment API caps a caller-supplied approval artifact at `HUMAN_VALIDATED`; it cannot self-assert or import formal authorization by metadata alone.

## Knowledge governance

The bundled catalogue is a pilot baseline, not legal advice. Normative sources carry authority type, effective dates, official URLs, and human-approval status. Production use requires provision-level mappings to be approved and maintained by the accountable Legal, Privacy, Security, and Governance owners.
