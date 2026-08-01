# AI Governance Engine

Evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, source material and supporting evidence, then produces a structured package that distinguishes supported, unknown, contradictory and blocking conditions.

## Project status

> **Active pre-production development.** The deterministic governance core, source-intake path, cognitive contract skeleton and reporting views are implemented and covered by automated tests. The Knowledge Base taxonomy and content are still being authored. Production identity, persistence, horizontal scaling, operational monitoring and deployment hardening are not complete.

The repository is suitable for controlled development and calibration. It is not a production certification service, legal-advice system or formal approval authority.

## Implemented foundation

- Source-first intake registers, classifies and hashes submitted artifacts and records exclusions in a content-addressed Source Ingestion Manifest.
- Deterministic assessment evaluates six governance domains across seven lifecycle stages.
- Evidence coverage, control assurance, residual risk and hard-gate status remain separate concepts.
- Missing evidence remains `UNKNOWN`; silence is not interpreted as safety, compliance or absence of an anti-pattern.
- Hard gates cannot be overridden by scores or generated narrative.
- Required human authorities are recorded without issuing formal approval.
- The canonical JSON package drives both the detailed Assessment Workspace and decision-ready Assurance Summary.
- HTML and printable views are derived from the package and do not calculate a second outcome.
- The optional cognitive pipeline preserves raw/derived lineage, verifies citations and keeps unsupported claims outside deterministic decision evidence.
- Knowledge authoring validates rich category JSON and compiles five runtime collections plus an immutable manifest.

## Authority and evidence flow

The cognitive contract is `3.0.0`. It is the only implemented cognitive pipeline; there is no separate shadow or compatibility implementation. `COGNITIVE_PIPELINE_ENABLED` controls the complete authenticated cognitive API and execution path.

```text
raw source
  -> derived source
  -> candidate fact or claim
  -> independent verification
  -> adjudicated claim
  -> locked finding
  -> deterministic decision and action
  -> controlled narrative
  -> fact-check
  -> publication gate
```

Only decision-eligible adjudicated claims become locked findings and deterministic evidence. Unsupported, conflicting and unverifiable claims remain in the audit ledger. Model output cannot directly change applicability, assurance, anti-pattern state, hard gates, readiness, lifecycle boundaries or formal authority.

The engine returns readiness recommendations such as `READY_WITH_CONDITIONS`, `REMEDIATE_BEFORE_NEXT_STAGE`, `HUMAN_REVIEW_REQUIRED` and `BLOCKED_IN_CURRENT_FORM`. Legal, Privacy, Security, Governance, AI Forum and AI Board decisions remain human acts. `FORMALLY_APPROVED` is reserved for a future trusted decision connector that verifies identity, authority, signature, scope and validity.

## Local development

Requirements:

- Node.js 20.16 or newer; CI and Amp orbs use Node.js 22.
- pnpm 10.34.5, pinned by the `packageManager` field.

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm start
```

The dashboard is served on port `4174` by default. Copy configuration from `.env.example` into your development environment; do not commit credentials.

The dashboard can upload a codebase folder or individual supported files, discover cited case information for review, and run the deterministic assessment. **Load credible sample** provides a local calibration case.

## Current deterministic API

`POST /api/assess` accepts the current dossier model and text sources:

```json
{
  "dossier": {
    "name": "Internal knowledge assistant",
    "intendedPurpose": "Answer employee questions from approved internal material",
    "expectedValue": "Reduce repeated support handling",
    "currentStage": "DESIGN_AND_DEVELOPMENT",
    "targetStage": "VERIFICATION_AND_VALIDATION",
    "jurisdictions": ["EU"],
    "roles": ["DEPLOYER"],
    "users": ["EMPLOYEES"],
    "accountableOwner": "Solution owner",
    "data": {
      "categories": ["SYNTHETIC", "PUBLIC_NON_PERSONAL"]
    },
    "exposure": {
      "currentUserAccess": "INTERNAL_ONLY",
      "intendedUserAccess": "INTERNAL_ONLY",
      "productionAccess": false,
      "consequentialDecisions": false
    },
    "agent": {
      "usesAgents": true,
      "canTakeActions": false,
      "irreversibleActions": false,
      "humanOverride": true
    },
    "classification": {
      "prohibitedPractice": false,
      "highRiskCandidate": false
    },
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

Additional deterministic endpoints:

- `POST /api/discover` performs MIME-aware source discovery without requiring a dossier.
- `GET /api/sample` returns a complete current sample request.
- `GET /api/knowledge` returns the active sanitized knowledge identity.
- `GET /api/knowledge/diagnostics` returns structural and referential diagnostics.
- `GET /api/config` returns non-secret experience and pipeline availability flags.

The deterministic package is schema `1.3.0`. It includes the Assessment Intake, field-level solution profile, documentation readiness, source-ingestion record, lifecycle transition boundary and Assurance Summary. Lexical matches remain automated indicators; they are not cognitive verification.

## Authenticated cognitive API

The cognitive API is disabled by default. When enabled, every `/api/v2/*` request requires `Authorization: Bearer <COGNITIVE_API_TOKEN>`.

- `POST /api/v2/runs/preflight` parses and screens evidence locally and returns redacted packet previews.
- `POST /api/v2/runs/{id}/discover` returns the cited intake draft.
- `POST /api/v2/runs/{id}/discover-recheck` performs an approved semantic recheck without overwriting deterministic facts.
- `POST /api/v2/runs/{id}/confirm` records the reviewed dossier without erasing source conflicts.
- `POST /api/v2/runs/{id}/execute` records explicit packet/provider approval and starts the run.
- `GET /api/v2/runs/{id}` returns progress.
- `GET /api/v2/runs/{id}/result` returns `ReadinessPackageV2` schema `2.5.0`.
- `DELETE /api/v2/runs/{id}` purges the ephemeral run record and evidence held by the run store.
- `GET /api/v2/models` exposes profile availability and approval state without credentials.

Supported intake includes common repository text and code, JSON, CSV, inert HTML, PDF, DOCX, XLSX, PNG, JPEG and WebP. Binary content uses base64. Office archives are checked for unsafe paths, macros, excessive expansion and suspicious compression. Source files, formulas, scripts, links and embedded instructions are not executed.

## Knowledge Base status

The bundled JavaScript catalogue is an explicitly `CALIBRATION_TEST_ONLY` bootstrap used for local development and tests. It is not an approved governance release and must not be presented as legal advice or a production control baseline.

The long-term source of truth is the authoring JSON described in [knowledge-authoring/README.md](knowledge-authoring/README.md). Category PDFs and the five runtime collections are generated views. The taxonomy, stable identifier policy, status model and complete approved content are still under development.

Production startup requires `VERCEL_KB_MANIFEST_URL`; it does not silently fall back to the local bootstrap catalogue. The loader verifies manifest and document hashes plus structural references. Approval and release-governance enforcement will be hardened as the taxonomy and Knowledge Base are finalized.

See [docs/knowledge-base.md](docs/knowledge-base.md) for the runtime manifest and compilation contract.

## Intentional current limitations

- The service is a development skeleton, not a multi-tenant production service.
- The v2 run store is process-local and in memory. Restarts lose active runs, and horizontal scaling is not supported.
- Cancellation purges the run-store copy, but run-scoped abort propagation to an already active provider request is not implemented yet.
- Authentication uses one service bearer token rather than tenant identity and authorization.
- The legacy deterministic endpoints are not protected by the v2 authentication and rate-limit guard.
- Aggregate run/provider concurrency, durable queues and financial budgets are not implemented.
- Production monitoring, centralized audit logging, malware scanning, persistence, incident response and deployment security validation remain future hardening work.
- Images currently rely on caller-provided sanitized metadata; a trusted image-sanitization service is not integrated.
- Knowledge taxonomy, identifiers and release content are not finalized.
- Final readiness packages are versioned by implementation contract but do not yet pass a separate runtime output-schema validator.

These limitations are development boundaries, not evidence that the corresponding production controls exist. See [SECURITY.md](SECURITY.md) and [docs/deployment.md](docs/deployment.md) for additional security and deployment context.

## Model qualification

Live benchmarking is opt-in because it sends approved packets to configured providers and incurs cost:

```bash
BENCHMARK_CONFIRM_LIVE_CALLS=true pnpm run benchmark:models
```

Use `BENCHMARK_PROFILE_IDS` to constrain the run. The harness checks structured output and zero-tolerance integrity conditions, but deliberately reports `REQUIRES_HUMAN_LABEL_REVIEW`. Human-labelled precision and high/critical recall must meet the qualification floors before profile IDs are added to `MODEL_PROFILE_APPROVALS`.

## Further documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Knowledge Base runtime contract](docs/knowledge-base.md)
- [Knowledge authoring workflow](knowledge-authoring/README.md)
- [Deployment skeleton](docs/deployment.md)
- [Security model](SECURITY.md)
