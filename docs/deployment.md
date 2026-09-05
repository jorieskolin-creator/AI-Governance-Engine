# Railway deployment

> This is a pre-production deployment skeleton for controlled assessment and iterative evaluation. It does not establish multi-tenant identity, horizontal scaling, production monitoring or operational approval.

1. Connect `jorieskolin-creator/AI-Governance-Engine` to a Railway service.
2. Set the root directory to the repository root and use the checked-in `railway.json`.
3. Keep the checked-in Railway start command, which enforces `NODE_ENV=production`; an external variable may repeat this value but must not override it.
4. Leave `VERCEL_KB_MANIFEST_URL` unset until the Maintainer publishes a hash-pinned runtime manifest with an allowed `releaseStatus`. Unset or blank uses the local unpublished snapshot (instrument loaded, Knowledge Base unpublished) so the service can start. Do not point this variable at a placeholder URL; a configured URL is fail-closed. When the Knowledge Base is published, set it to the immutable approved Vercel knowledge manifest.
5. Configure `BLOB_READ_WRITE_TOKEN` only if the Blob objects require bearer authentication.
6. Run the manual `verify-knowledge-manifest` workflow against the same URL, or execute `pnpm run kb:verify-runtime` in an authorized environment.
7. Optionally set `ALLOWED_ORIGIN` to the Railway public URL.
8. Set `ADMIN_SECRET` to the shared write password. The dashboard remains readable without it; uploads, intake edits and analysis require the password. Leave it unset only for local tests.
9. Provision PostgreSQL and set `DATABASE_URL` when durable safe-run checkpoints are required. Startup idempotently applies `db/migrations/001_governance_runs.sql`.
10. Keep `COGNITIVE_RUN_LEASE_MS` longer than `COGNITIVE_MAX_RUN_MS`; the defaults are 20 and 15 minutes respectively.
11. Configure `COGNITIVE_MAX_ACTIVE_RUNS` for per-process queue concurrency and keep `COGNITIVE_QUEUE_POLL_MS` operationally reasonable.
12. Deploy. Railway executes `pnpm run check`, starts `pnpm start`, and probes `/health`.

Railway captures the service's structured JSON stdout. Expected events include `service_started`, Intake preflight/retrieval/re-read/proposal outcomes, `intake_final_approval_completed`, cognitive queue/start/finish transitions, `cognitive_step_checkpoint`, `request_failed_safely`, and normalized `http_request_completed` records. Use the opaque `requestId` and `runId`, stable `failureCode`, `runStage`, `step`, `stepStatus` and aggregate counts for diagnosis. The logger deliberately excludes uploaded content and paths, request bodies, prompts, provider responses, credentials, IP addresses and arbitrary exception messages.

Knowledge Base publication and Engine activation are separate operations. The Maintainer makes an immutable release available; this deployment owns selecting it, restarting safely, and confirming `/api/knowledge` plus `/api/knowledge/diagnostics`. No Engine source checkout or callback is required in the Maintainer pipeline.

## Always-on cognitive contract

Contract 3.1.0 is the only implemented cognitive pipeline. There is no user-facing provider switch, client API token, or feature flag. The built-in UI starts the server-side evidence-gated route automatically.

Before decision-ready use:

1. Keep provider keys server-side: `OPENAI_API_KEY` (preferred) or `GPT_API_KEY`, `XAI_API_KEY`, and `MOONSHOT_API_KEY`. Configure primary and fallback provider/model pairs for `WORKHORSE`, `REASONER`, and `QUALITY_CHECKER`; provider values are exactly `OPENAI`, `XAI`, or `MOONSHOT`.
2. Intake retrieval sends only safe metrics and controlled signals; invalid returned search terms are removed locally. Proposal requests send only deterministic summaries, field-mapped `semantic-intake-evidence-1.0.0` observations and explicitly selected controlled facts. These actions retain no Intake or analysis authority. The optional benchmark remains available with `BENCHMARK_CONFIRM_LIVE_CALLS=true`, but does not gate normal execution.
3. Review the six deduplicated configured `roleSlots` exposed by versioned contract `model-policy-view-1.1.0` at `/api/v2/models`. Runtime readiness requires credentials for their providers and a valid independent route topology; it does not require a separate profile approval variable.
4. Compare the 2.6.0 audit packages, coverage matrices, unresolved ledgers, publication gates, costs and reviewer labels against approved golden cases in a controlled environment.
5. Verify the versioned intake questionnaire and all referenced normative sources are hash-pinned in the production manifest.

Packet/provider authorization is enforced for each actual transmission rather than requiring one provider for the complete dossier. Before queue admission, the configured role topology must provide an assessor, a different-provider verifier, and a third-provider adjudicator, plus independent solution verification and synthesis fact-checking routes. A run fails closed when cross-provider verification cannot be performed, mandatory assessment coverage is incomplete, a required model stage fails, the returned model identity differs from the configured model, or a global/per-stage model budget is exhausted. Eligible provider failures—including timeout and quota/rate-limit failure—advance to the configured fallback only when evidence authorization and provider-independence constraints still hold. Cancellation, lease loss and Engine budget exhaustion do not trigger fallback.

Without `DATABASE_URL`, the development run store is in memory. With PostgreSQL, the service stores hash-validated safe checkpoints and coordinates mutation through expiring worker leases. The lease is renewed at each versioned cognitive-step boundary and every `COGNITIVE_RUN_HEARTBEAT_MS`; configure the heartbeat comfortably below `COGNITIVE_RUN_LEASE_MS`. Raw source units, uploaded file contents and media bytes are never persisted in PostgreSQL: they expire after 60 minutes and are purged at cognitive queue admission or any terminal outcome. Consequently, restart before user approval requires re-upload. Approved Intake and completed results can recover, while an interrupted provider run fails closed for explicit user restart rather than automatically duplicating calls.

`POST /api/v2/runs/{id}/execute` purges local raw source units after validating the approved Intake, records the release, and durably queues only safe-summary work. PostgreSQL workers claim queued records atomically using `FOR UPDATE SKIP LOCKED`; in-memory development uses the same queue contract without cross-process durability. Queue concurrency is bounded per process, not cluster-wide. Because image pixels never enter provider packets and are purged at queue admission, image-summary work can be claimed by any worker. An interrupted run is never automatically requeued. `POST /api/v2/runs/{id}/restart` requires `confirmed: true`, an `actorRef`, and purpose `RESTART_INTERRUPTED_COGNITIVE_RUN_WITH_POSSIBLE_DUPLICATE_CALLS`. The previous step ledger and safe transmission manifest are retained in attempt history.

`/health` returns the active knowledge version, manifest hash, source, entry counts and a non-secret `cognitiveReadiness` summary. Process health remains distinct from cognitive readiness: `CONFIGURATION_REQUIRED` reports credential counts, configured role-slot counts, topology status and stable issue codes without exposing secret values. An unreachable, malformed, incomplete, or hash-invalid configured knowledge snapshot prevents startup. An unset manifest URL does not: the process starts on the local unpublished snapshot. The selected Knowledge Base release status remains visible and can limit report authority, but a structurally valid non-approved release does not create a separate Engine mode.

PostgreSQL remains optional for local development. Production integration must additionally apply tenant isolation, encryption, backup and retention policies, database authorization, operational migration controls and append-only human-decision auditing. The current schema establishes durable checkpoints and leases; it does not claim those enterprise platform controls.
