# AI Governance Engine

Evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, source material and supporting evidence, then produces a structured package that distinguishes supported, unknown, contradictory and blocking conditions.

## Project status

> **Active pre-production development.** The deterministic governance core, source-intake path, cognitive contract skeleton and reporting views are implemented and covered by automated tests. The Knowledge Base taxonomy and content are still being authored. Production identity, persistence, horizontal scaling, operational monitoring and deployment hardening are not complete.

The repository is suitable for controlled development and calibration. It is not a production certification service, legal-advice system or formal approval authority.

## Implemented foundation

- Source-first intake registers, classifies and hashes submitted artifacts and records exclusions in a content-addressed Source Ingestion Manifest.
- Evidence acquisition uses versioned lanes. Raw documents, code, configuration, tabular values and image pixels remain local and are replaced in provider-eligible packets by validated summaries containing only controlled enums, coarse dimensions, lineage references and explicit limitations. A separate `acquired-fact-package-1.0.0` withholds free text, dates, unknowns, conflicts and policy-excluded fields; users may explicitly select only eligible controlled values for an optional proposal request.
- Deterministic assessment evaluates six governance domains across seven lifecycle stages.
- Evidence coverage, control assurance, residual risk and hard-gate status remain separate concepts.
- Missing evidence remains `UNKNOWN`; silence is not interpreted as safety, compliance or absence of an anti-pattern.
- Hard gates cannot be overridden by scores or generated narrative.
- Required human authorities are recorded without issuing formal approval.
- The canonical JSON package drives both the detailed Assessment Workspace and decision-ready Assurance Summary.
- HTML and printable views are derived from the package and do not calculate a second outcome.
- The standard cognitive pipeline preserves raw/derived lineage, verifies citations and keeps unsupported claims outside deterministic decision evidence.
- Knowledge authoring validates rich category JSON and compiles five runtime collections plus an immutable manifest.

Every normal assessment uses cognitive contract `3.0.0`: independently verified solution understanding, immutable raw/derived evidence lineage, object-level assessment coverage, parallel A–F claim extraction, independent verification, bounded rescan/adjudication, deterministic assessment, controlled synthesis, repair/re-analysis, and a separate publication gate.

## Authority and evidence flow

The cognitive contract is `3.0.0`. It is the only implemented cognitive pipeline; there is no separate shadow or compatibility implementation. It is the normal browser assessment path; users never enter credentials or select providers.

```text
raw source (local only)
  -> deterministic safe summary or user-approved Intake
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

The fixed initial route is Anthropic for discovery and A–F assessment, OpenAI for independent verification and controlled synthesis, Gemini for disputed-claim adjudication, and Anthropic for final fact-checking. Missing primary or independent-provider availability produces `COGNITIVE_ASSESSMENT_INCOMPLETE`, never a silent positive fallback.

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

The dashboard can upload a codebase folder or individual supported files. **Discover case information** performs local DLP screening, deterministic discovery, and a cited AI semantic recheck. After every applicable field has an explicit user resolution, **Approve Filled Information and Continue to Analysis** creates an immutable Intake revision and runs the evidence-gated pipeline. **Load credible sample** follows the same source-first workflow.

## Approved Intake API

The supported assessment workflow uses the v2 run state machine:

1. `POST /api/v2/runs/preflight` parses and screens sources, then builds the deterministic Intake draft.
2. After reviewing the safe summary package and optional controlled acquired facts, `POST /api/v2/runs/{runId}/discover-recheck` with explicit purpose confirmation optionally requests cited GenAI Intake proposals. Selected facts cross this boundary only as `acquired-fact-selection-1.0.0`; free text and raw material cannot be selected. Skipping this step does not block manual resolution.
3. `POST /api/v2/runs/{runId}/confirm` requires a resolution for every applicable field plus explicit user approval, then creates the immutable approved Intake snapshot. Accepted, edited and declined proposal decisions remain distinguishable; declining a proposal does not prevent a manual value, `Unknown`, or field-permitted `Not Applicable` resolution.
4. `POST /api/v2/runs/{runId}/execute` starts A–F assessment from that snapshot.
5. `GET /api/v2/runs/{runId}` and `GET /api/v2/runs/{runId}/result` expose progress and the result.

`POST /api/assess` is retired and returns HTTP 410 because a one-shot request cannot enforce the approved Intake boundary. Library-level deterministic assessment functions remain available to tests and internal code, but their output must not be represented as an approved v2 pipeline result.

Supporting read-only endpoints include `GET /api/sample`, `GET /api/knowledge`, `GET /api/knowledge/diagnostics`, `GET /api/intake-field-registry` and `GET /api/config`.

## Cognitive API and safeguards

The browser calls the normal cognitive path automatically. Provider credentials stay on the server, and execution automatically records the configured provider route and approved redacted packet transmission.

- `POST /api/v2/runs/preflight` parses and screens evidence locally and returns redacted packet previews.
- `POST /api/v2/runs/{id}/discover` returns the cited intake draft.
- `POST /api/v2/runs/{id}/discover-recheck` performs a cited semantic recheck without overwriting deterministic facts.
- `POST /api/v2/runs/{id}/confirm` validates explicit field resolutions and creates the user-approved Intake snapshot without erasing source conflicts.
- `POST /api/v2/runs/{id}/execute` records the fixed server-side route and starts the run.
- `GET /api/v2/runs/{id}` returns progress.
- `GET /api/v2/runs/{id}/result` returns `ReadinessPackageV2` schema `2.5.0`.
- `DELETE /api/v2/runs/{id}` purges the ephemeral run record and evidence held by the run store.
- `GET /api/v2/models` exposes the non-secret fixed policy without credentials.

Supported intake includes common repository text and code, JSON, CSV, inert HTML, PDF, DOCX, XLSX, PNG, JPEG and WebP. Binary content uses base64. Office archives are checked for unsafe paths, macros, excessive expansion and suspicious compression. Source files, formulas, scripts, links and embedded instructions are not executed. Documents enter `DOCUMENT_LOCAL_ANALYSIS`; code/configuration enter `CODE_CONFIGURATION_LOCAL_ANALYSIS`; CSV/XLSX enter `TABULAR_LOCAL_ANALYSIS`; images enter `MEDIA_LOCAL_METADATA`. Raw content, cell values and pixels remain process-local. Provider packets contain only schema-validated deterministic summaries plus the user-approved canonical Intake. Document summaries expose controlled topic and risk signals, not text, names, values or quotes, and therefore cannot establish documentary claims or control effectiveness.

## Knowledge Base status

The bundled JavaScript catalogue is an explicitly `CALIBRATION_TEST_ONLY` bootstrap used for local development and tests. It is not an approved governance release and must not be presented as legal advice or a production control baseline.

The long-term source of truth is the authoring JSON described in [knowledge-authoring/README.md](knowledge-authoring/README.md). Category PDFs and the five runtime collections are generated views. The taxonomy, stable identifier policy, status model and complete approved content are still under development.

Production startup requires `VERCEL_KB_MANIFEST_URL`; it does not silently fall back to the local bootstrap catalogue. The loader verifies manifest and document hashes plus structural references. Approval and release-governance enforcement will be hardened as the taxonomy and Knowledge Base are finalized.

The Knowledge Base Maintainer is a separate producer. The Engine does not import Maintainer source code or share its database or process state. A Maintainer release is `PUBLISHED` when its immutable artifacts are available; Engine activation happens separately when this deployment selects that manifest. An Engine-owned manual `verify-knowledge-manifest` workflow, or `pnpm run kb:verify-runtime`, verifies an approved published manifest before activation.

See [docs/knowledge-base.md](docs/knowledge-base.md) for the runtime manifest and compilation contract.

## Intentional current limitations

- The service is a development skeleton, not a multi-tenant production service.
- The v2 run store is process-local and in memory. Restarts lose active runs, and horizontal scaling is not supported.
- Cancellation purges the run-store copy, but run-scoped abort propagation to an already active provider request is not implemented yet.
- Authentication and tenant authorization remain production-hardening work.
- The legacy deterministic endpoint is retained for compatibility and is not the browser assessment path.
- Run/provider concurrency and financial budgets are enforced per run; durable queues and aggregate service-wide budgets remain future hardening.
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

Use `BENCHMARK_PROFILE_IDS` to constrain cost. The harness checks structured output and zero-tolerance integrity conditions, but deliberately reports `REQUIRES_HUMAN_LABEL_REVIEW`. Human-labelled precision and high/critical recall must meet the qualification floors before the fixed route is treated as qualified for decision-ready assessments.

## Further documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Knowledge Base runtime contract](docs/knowledge-base.md)
- [Knowledge authoring workflow](knowledge-authoring/README.md)
- [Deployment skeleton](docs/deployment.md)
- [Security model](SECURITY.md)
