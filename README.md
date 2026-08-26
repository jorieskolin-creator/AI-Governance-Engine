# AI Governance Engine

Evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, source material and supporting evidence, then produces a structured package that distinguishes supported, unknown, contradictory and blocking conditions.

## Project status

> **Active pre-production development.** The deterministic governance core, source-intake path, cognitive contract skeleton and reporting views are implemented and covered by automated tests. The Knowledge Base taxonomy and content are still being authored. Production identity, persistence, horizontal scaling, operational monitoring and deployment hardening are not complete.

The repository is suitable for controlled pre-production assessment runs and iterative evaluation. It is not a production certification service, legal-advice system or formal approval authority.

## Implemented foundation

- Source-first intake registers, classifies and hashes submitted artifacts and records exclusions in a content-addressed Source Ingestion Manifest.
- Optional PostgreSQL orchestration persists content-hashed safe checkpoints and uses worker leases to serialize mutation and execution. Raw source units are never written to the orchestration database.
- Cognitive execution follows a versioned seven-step ledger. Every executable major step is checkpointed before and after work, ordering is deterministic, and the worker lease is renewed at each boundary.
- Active execution also renews its lease on a timed heartbeat. Cancellation propagates through an abort signal to provider transport, and deterministic failure codes distinguish retryable provider conditions from configuration, budget, cancellation and human-review states.
- Evidence acquisition uses versioned lanes. Raw documents, code, configuration, tabular values and image pixels remain local and are replaced in provider-eligible packets by validated summaries containing only controlled enums, coarse dimensions, lineage references and explicit limitations. A parallel `semantic-intake-evidence-1.0.0` projection exposes only allow-listed concepts, neutral source representations and field mappings for Intake drafting; it contains no raw text, names, values, quotes or code. A separate `acquired-fact-package-1.1.0` withholds free text, dates, unknowns, conflicts and policy-excluded fields; users may explicitly select only eligible controlled values for an optional proposal request.
- Deterministic assessment evaluates six governance domains across seven lifecycle stages.
- Evidence coverage, control assurance, residual risk and hard-gate status remain separate concepts.
- Missing evidence remains `UNKNOWN`; silence is not interpreted as safety, compliance or absence of an anti-pattern.
- Hard gates cannot be overridden by scores or generated narrative.
- Required human authorities are recorded without issuing formal approval.
- The canonical JSON package drives both the detailed Assessment Workspace and decision-ready Assurance Summary.
- HTML and printable views are derived from the package and do not calculate a second outcome.
- The standard cognitive pipeline preserves raw/derived lineage, verifies citations and keeps unsupported claims outside deterministic decision evidence.
- Knowledge authoring validates schema `2.1.0` category and tactic JSON and compiles six runtime collections plus an immutable manifest.

Every normal assessment uses cognitive contract `3.1.0`: independently verified solution understanding, immutable raw/derived evidence lineage, object-level assessment coverage, parallel A–F claim extraction, independent verification, bounded rescan/adjudication, deterministic assessment, controlled synthesis, repair/re-analysis, and a separate publication gate.

## Authority and evidence flow

The cognitive contract is `3.1.0`. It is the only implemented cognitive pipeline; there is no separate shadow or compatibility implementation. It is the normal browser assessment path; users never enter credentials or select providers.

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

The fixed cognitive stages map to three operational roles: `WORKHORSE` handles retrieval planning, semantic routing and routine domain assessment; deterministic extraction remains local. `REASONER` handles editable Intake proposals, solution understanding, adjudication and synthesis. `QUALITY_CHECKER` handles verification and fact-checking. Each role has a deterministic primary and fallback provider/model assignment. Configured, credentialed routes execute directly; there is no separate qualification or test mode. An eligible fallback is attempted after provider failure, timeout, quota/rate-limit failure, refusal, unexpected model identity, or exhausted structured-output repair. Cancellation, lease loss and Engine budget exhaustion never trigger fallback. Cross-provider verification and adjudication exclusions take precedence over role preference, and route admission verifies an independent verifier and third-provider adjudicator. Every response is normalized and schema-validated locally, and the actual provider/model used is retained in provenance.

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

The dashboard can upload a codebase folder or individual supported files. **Discover case information** performs local DLP screening and deterministic discovery. Optional retrieval suggestions and editable GenAI Intake proposals are separate, explicitly requested actions over privacy-safe contracts. Supported proposals are prefilled once into empty applicable fields; they never overwrite deterministic or user-entered values and have no separate acceptance action. The user may edit or remove them. After every applicable field has an explicit user resolution, **Approve Filled Information and Continue to Analysis** is the only action that accepts the filled information, creates an immutable Intake revision and runs the evidence-gated pipeline. **Load credible sample** follows the same source-first workflow.

## Approved Intake API

The supported assessment workflow uses the v2 run state machine:

1. `POST /api/v2/runs/preflight` parses and screens sources, then builds the deterministic Intake draft.
2. After reviewing the safe summary package and optional controlled acquired facts, `POST /api/v2/runs/{runId}/discover-recheck` with explicit purpose confirmation optionally requests cited GenAI Intake proposals. Missing-field wording may be synthesized only from field-mapped controlled semantic observations or selected acquired facts. Already acquired local free-text values are not retargeted merely because they are withheld from providers. Selected facts cross this boundary only as `acquired-fact-selection-1.0.0`; free text and raw material cannot be selected. The browser prefills supported proposals only into still-empty fields and leaves them editable or removable. Skipping this step does not block manual resolution.
3. `POST /api/v2/runs/{runId}/confirm` requires a resolution for every applicable field plus explicit user approval, then creates the immutable approved Intake snapshot. At this final boundary, an unchanged prefill is recorded as accepted, a changed prefill as edited, and a removed prefill as declined. There is no earlier proposal-acceptance action, and removing a proposal does not prevent a manual value, `Unknown`, or field-permitted `Not Applicable` resolution.
4. `POST /api/v2/runs/{runId}/execute` starts A–F assessment from that snapshot.
5. `GET /api/v2/runs/{runId}` and `GET /api/v2/runs/{runId}/result` expose progress and the result.

`POST /api/assess` is retired and returns HTTP 410 because a one-shot request cannot enforce the approved Intake boundary. Library-level deterministic assessment functions remain available to tests and internal code, but their output must not be represented as an approved v2 pipeline result.

Supporting read-only endpoints include `GET /api/sample`, `GET /api/knowledge`, `GET /api/knowledge/diagnostics`, `GET /api/intake-field-registry` and `GET /api/config`.

## Cognitive API and safeguards

The browser calls the normal cognitive path automatically. Provider credentials stay on the server, and execution automatically records the configured provider route and approved redacted packet transmission.

- `POST /api/v2/runs/preflight` parses and screens evidence locally and returns redacted packet previews.
- `POST /api/v2/runs/{id}/discover` returns the cited intake draft.
- `POST /api/v2/runs/{id}/retrieval-plan` optionally creates suggestion-only retrieval guidance from validated safe metrics after explicit user confirmation.
- `POST /api/v2/runs/{id}/retrieval-plan/execute` performs one separately confirmed bounded local re-read without provider access.
- `POST /api/v2/runs/{id}/discover-recheck` proposes cited, editable missing-field wording from privacy-safe semantic observations without overwriting deterministic facts.
- `POST /api/v2/runs/{id}/confirm` validates explicit field resolutions and creates the user-approved Intake snapshot without erasing source conflicts.
- `POST /api/v2/runs/{id}/execute` records the fixed server-side route and starts the run.
- `POST /api/v2/runs/{id}/restart` requeues an interrupted safe-summary run only after explicit acknowledgement that prior provider-call completion may be uncertain.
- `GET /api/v2/runs/{id}` returns progress.
- `GET /api/v2/runs/{id}/result` returns `ReadinessPackageV2` schema `2.6.0` after mandatory local structural and integrity validation.
- `GET /api/v2/contracts/readiness-package/2.6.0` publishes its draft 2020-12 top-level integration schema, governance invariants, and closed privacy-safe source-ingestion and evidence-ledger shapes; the response identifies its coverage explicitly, while local runtime validation remains authoritative for package hashes and cross-ledger integrity.
- `DELETE /api/v2/runs/{id}` purges the run record and evidence held by the active run store.
- `GET /api/v2/models` exposes the non-secret fixed policy without credentials.

Supported intake includes common repository text and code, JSON, CSV, inert HTML, PDF, DOCX, XLSX, PNG, JPEG and WebP. Binary content uses base64. Office archives are checked for unsafe paths, macros, excessive expansion and suspicious compression. Source files, formulas, scripts, links and embedded instructions are not executed. Documents enter `DOCUMENT_LOCAL_ANALYSIS` or, for sparse scanned PDF pages, `DOCUMENT_LOCAL_OCR_ANALYSIS`; code/configuration enter `CODE_CONFIGURATION_LOCAL_ANALYSIS`; CSV/XLSX enter `TABULAR_LOCAL_ANALYSIS`; images enter `MEDIA_LOCAL_OCR_ANALYSIS`. OCR is bounded and local, and low-confidence text requires review rather than populating Intake. Raw content, unrestricted OCR text, cells, values and pixels remain process-local. Provider packets contain only schema-validated deterministic summaries plus the user-approved canonical Intake. Document summaries expose controlled topic and screening signals, not text, names, values or quotes. The additive semantic Intake projection uses a closed vocabulary and opaque source references, preserves document/code/configuration representations separately, ignores dependency lockfiles and build/vendor trees, and performs no source comparison or governance assessment. It supports optional drafting only and cannot establish implementation state, control effectiveness or an Intake decision.

PDF native text is reconstructed into bounded headings and paragraphs before local screening. A first-page PDF title may become a medium-confidence solution-name candidate, and the first paragraph of an explicitly named purpose, intended-use, overview or solution-brief PDF may become a medium-confidence intended-purpose candidate. Generic framework manifest names and instructional README headings are excluded from solution-name acquisition. Selected-file exceptions and final parse failures are disclosed by path and reason in the browser. A privacy-safe package does not imply provider availability: optional GenAI acquisition controls require a configured role route with an available server-side credential.

## Knowledge Base status

The bundled JavaScript catalogue is an explicitly `CALIBRATION_TEST_ONLY` bootstrap used for local development and tests. It is not an approved governance release and must not be presented as legal advice or a production control baseline.

The long-term source of truth is the schema-validated authoring JSON described in [knowledge-authoring/README.md](knowledge-authoring/README.md). Category PDFs and the six runtime collections are generated views. The 30 capability/anti-pattern pairs, stable identifier grammar and approved Playbook object mappings are defined; the complete approved category content is still under development.

Production startup requires `VERCEL_KB_MANIFEST_URL`; it does not silently fall back to the local bootstrap catalogue. The loader verifies manifest and document hashes plus structural references. Approval and release-governance enforcement will be hardened as the taxonomy and Knowledge Base are finalized.

The Knowledge Base Maintainer is a separate producer. The Engine does not import Maintainer source code or share its database or process state. A Maintainer release is `PUBLISHED` when its immutable artifacts are available; Engine activation happens separately when this deployment selects that manifest. An Engine-owned manual `verify-knowledge-manifest` workflow, or `pnpm run kb:verify-runtime`, verifies an approved published manifest before activation.

See [docs/knowledge-base.md](docs/knowledge-base.md) for the runtime manifest and compilation contract.

## Intentional current limitations

- The service is a development skeleton, not a multi-tenant production service.
- Without `DATABASE_URL`, the v2 run store remains process-local and restarts lose active runs. With PostgreSQL, approved Intake and terminal safe state are recoverable; pre-approval recovery requires source re-upload because raw evidence is deliberately excluded, and interrupted provider execution is never resumed automatically.
- After final Intake approval, queue admission purges local raw source units and retains only the durable safe-summary package plus an audit marker. PostgreSQL workers atomically claim that work with bounded service concurrency. Queued work that never started can recover automatically; interrupted work never replays without the explicit recovery acknowledgement.
- Cancellation aborts provider requests on the owning worker and purges evidence. In a multi-worker PostgreSQL deployment, cancellation on another worker is observed through failed heartbeat renewal; the current schema does not use PostgreSQL notifications for immediate cross-worker signalling.
- Authentication and tenant authorization remain production-hardening work.
- The legacy deterministic endpoint is retained for compatibility and is not the browser assessment path.
- Run/provider concurrency and financial budgets are enforced per run; queue fairness, tenant quotas and aggregate service-wide budgets remain future hardening.
- Production monitoring, centralized audit logging, malware scanning, long-term package retention, incident response and deployment security validation remain future hardening work.
- The service emits privacy-safe structured JSON operational logs to stdout for Railway collection. Logs include normalized route templates, opaque run/request identifiers, stable failure codes, stages, durations and aggregate counts; request bodies, source paths/content, prompts, provider responses, credentials and IP addresses are excluded. Centralized retention, alerting and audit governance remain deployment responsibilities.
- Images currently rely on caller-provided sanitized metadata; a trusted image-sanitization service is not integrated.
- Knowledge taxonomy, identifiers and release content are not finalized.
- Final readiness packages pass a versioned local structural, JSON-safety, authority-boundary and integrity validator before they can be returned or persisted. Full leaf-level JSON Schema publication remains future contract hardening.

These limitations are development boundaries, not evidence that the corresponding production controls exist. See [SECURITY.md](SECURITY.md) and [docs/deployment.md](docs/deployment.md) for additional security and deployment context.

## Model evaluation

Live benchmarking is opt-in because it sends approved packets to configured providers and incurs cost:

```bash
BENCHMARK_CONFIRM_LIVE_CALLS=true pnpm run benchmark:models
```

Use `BENCHMARK_PROFILE_IDS` to constrain cost. The optional harness checks structured output and zero-tolerance integrity conditions and reports `HUMAN_LABEL_REVIEW_RECOMMENDED`; it is a diagnostic tool, not a runtime gate. Normal controlled Engine runs provide the primary evidence for iterative model, prompt, precision, recall, cost and failure-behavior evaluation.

Runtime execution requires all configured role-slot credentials and a valid independent three-provider topology. Intake retrieval and proposal actions remain explicitly requested, privacy-safe, schema-validated and user-controlled; they cannot approve Intake or start analysis. Changing a configured model takes effect on the next route selection and is visible through `/api/v2/models` and execution provenance.

## Further documentation

- [Architecture and trust boundaries](docs/architecture.md)
- [Knowledge Base runtime contract](docs/knowledge-base.md)
- [Knowledge authoring workflow](knowledge-authoring/README.md)
- [Deployment skeleton](docs/deployment.md)
- [Security model](SECURITY.md)
