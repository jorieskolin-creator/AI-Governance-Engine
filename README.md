# Vivicta AI Governance Engine

Standalone, evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, a codebase/source packet, and supporting evidence. It produces a structured readiness package that explains what is supported, unknown, contradictory, blocked, and required next.

This is a clean governance implementation inspired by the FinOps Engine's processing pattern. It contains no FinOps criteria, maturity model, scoring, personas, prompts, tactics, or terminology.

## What the engine does

- Registers and hashes every submitted source.
- Scans code, configuration, tests, reviews, and operational records for governance-relevant signals.
- Evaluates six governance domains across seven lifecycle stages.
- Separates evidence coverage, control assurance, residual risk, and hard-gate status.
- Preserves silence as `UNKNOWN`; it never treats missing evidence as proof of safety or compliance.
- Selects approved governance actions only from verified findings.
- Produces one canonical JSON readiness package with two connected views: the detailed Assessment Workspace and the decision-ready Assurance Summary.
- Exports the Assurance Summary as a printable A4 report and a script-free, self-contained HTML file that works offline.
- Records required human authorities without issuing formal approval.

## Evidence-gated cognitive pipeline (v2)

The optional v2 path adds semantic solution understanding, parallel A-F claim extraction, independent verification, targeted rescan/adjudication, deterministic assessment, controlled synthesis, and a separate fact-check. Its invariant is:

`untrusted source → candidate claim → independent verification → locked finding → deterministic decision → controlled synthesis`

Only locked findings become evidence for the deterministic engine. Raw model output cannot change applicability, assurance, anti-pattern state, hard gates, readiness, or formal authority.

The v2 endpoints are disabled by default and require a bearer token:

- `POST /api/v2/runs/preflight` parses and screens evidence locally and returns redacted packet previews.
- `POST /api/v2/runs/{id}/execute` records explicit packet/provider approval and starts the run.
- `GET /api/v2/runs/{id}` returns progress.
- `GET /api/v2/runs/{id}/result` returns `ReadinessPackageV2`.
- `DELETE /api/v2/runs/{id}` cancels and purges the ephemeral evidence.
- `GET /api/v2/models` shows profile availability and approval state without exposing credentials.

Preflight accepts UTF-8 or base64 content with an explicit MIME type. Supported formats are text/code/JSON/CSV, PDF, DOCX, XLSX, PNG, JPEG, and WebP. Office archives are checked for unsafe paths, macros, excessive expansion, and suspicious compression. Files, macros, spreadsheet formulas, scripts, links, and source instructions are never executed or calculated. Images must be marked by the caller as sanitized before they can be transmitted.

Production model profiles are allow-listed through `MODEL_PROFILE_APPROVALS`. Pilot profiles are never promoted automatically.

## Run

Use Node.js 20.16 or newer. Install the pinned parser dependencies before starting:

```powershell
npm install
npm test
npm start
```

Open `http://localhost:4174`. Use **Load credible sample** to inspect the complete output or fill the dossier and upload a code folder.

The post-assessment result opens in **Assurance Summary** when `ASSURANCE_SUMMARY_ENABLED=true`. Switch to **Assessment Workspace** without rerunning the assessment. The summary provides the immutable decision and lifecycle boundary, hard gates, A–F status, strengths, blockers, actions, human authority, limitations, and a minimized evidence digest.

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

`GET /api/sample` returns a complete sample request. `GET /api/knowledge` returns the active, versioned knowledge manifest. `GET /api/config` exposes non-secret experience flags.

`ReadinessPackageV2` is additive at schema version `2.1.0`. Both v1 and v2 packages include `transitionBoundary` and `assuranceSummary`; v1 evidence is explicitly labelled as automated indicators because cognitive verification was not run.

### v2 preflight example

```json
{
  "dossier": { "...": "same dossier contract as v1" },
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

Use `Authorization: Bearer <COGNITIVE_API_TOKEN>` for every `/api/v2/*` request. Submit every returned packet ID to `/execute` with the explicitly approved provider names. A high/critical claim needs a provider different from its extractor; insufficient provider approval produces `COGNITIVE_ASSESSMENT_INCOMPLETE` rather than a positive recommendation.

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
