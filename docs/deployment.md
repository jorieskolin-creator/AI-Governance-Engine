# Railway deployment

> This is a pre-production deployment skeleton for controlled development and calibration. It does not establish multi-tenant identity, durable run state, horizontal scaling, production monitoring or operational approval.

1. Connect `jorieskolin-creator/AI-Governance-Engine` to a Railway service.
2. Set the root directory to the repository root and use the checked-in `railway.json`.
3. Configure `NODE_ENV=production`.
4. Configure `VERCEL_KB_MANIFEST_URL` to the immutable, approved Vercel knowledge manifest.
5. Configure `BLOB_READ_WRITE_TOKEN` only if the Blob objects require bearer authentication.
6. Run the manual `verify-knowledge-manifest` workflow against the same URL, or execute `pnpm run kb:verify-runtime` in an authorized environment.
7. Optionally set `ALLOWED_ORIGIN` to the Railway public URL.
8. Provision PostgreSQL and set `DATABASE_URL` when durable safe-run checkpoints are required. Startup idempotently applies `db/migrations/001_governance_runs.sql`.
9. Keep `COGNITIVE_RUN_LEASE_MS` longer than `COGNITIVE_MAX_RUN_MS`; the defaults are 20 and 15 minutes respectively.
10. Configure `COGNITIVE_MAX_ACTIVE_RUNS` for per-process queue concurrency and keep `COGNITIVE_QUEUE_POLL_MS` operationally reasonable.
11. Deploy. Railway executes `pnpm run check`, starts `pnpm start`, and probes `/health`.

Knowledge Base publication and Engine activation are separate operations. The Maintainer makes an immutable release available; this deployment owns selecting it, restarting safely, and confirming `/api/knowledge` plus `/api/knowledge/diagnostics`. No Engine source checkout or callback is required in the Maintainer pipeline.

## Always-on cognitive contract

Contract 3.1.0 is the only implemented cognitive pipeline. There is no user-facing provider switch, client API token, or feature flag. The built-in UI starts the server-side evidence-gated route automatically.

Before decision-ready use:

1. Keep provider keys server-side: `OPENAI_API_KEY` (preferred) or `GPT_API_KEY`, `XAI_API_KEY`, and `MOONSHOT_API_KEY`. Model identities have documented route defaults but are not qualified by this repository's automated tests; pin reviewed candidates with `OPENAI_COGNITIVE_MODEL`, `XAI_COGNITIVE_MODEL`, and `MOONSHOT_COGNITIVE_MODEL` before live qualification.
2. Run `pnpm run benchmark:models` in a controlled environment with `BENCHMARK_CONFIRM_LIVE_CALLS=true` and review the output against the qualification floors.
3. Add only qualified exact `profile-id@model-id` references to the comma-separated `MODEL_PROFILE_APPROVALS`. Production routing fails closed when a route is absent or its configured model identity changes.
4. Compare the 2.6.0 audit packages, coverage matrices, unresolved ledgers, publication gates, costs and reviewer labels against approved golden cases in a controlled environment.
5. Verify the versioned intake questionnaire and all referenced normative sources are hash-pinned in the production manifest.

The service will not run pilot profiles in production. Packet/provider approval is enforced for each actual transmission rather than requiring one provider for the complete dossier. A run fails closed when cross-provider verification cannot be performed, mandatory assessment coverage is incomplete, a required model stage fails, the approved model identity changes, or a global/per-stage model budget is exhausted.

Without `DATABASE_URL`, the development run store is in memory. With PostgreSQL, the service stores hash-validated safe checkpoints and coordinates mutation through expiring worker leases. The lease is renewed at each versioned cognitive-step boundary and every `COGNITIVE_RUN_HEARTBEAT_MS`; configure the heartbeat comfortably below `COGNITIVE_RUN_LEASE_MS`. Raw source units, uploaded file contents and media bytes are never persisted in PostgreSQL: they expire after 60 minutes and are purged after success, failure, cancellation or timeout. Consequently, restart before user approval requires re-upload. Approved Intake and completed results can recover, while an interrupted provider run fails closed for explicit user restart rather than automatically duplicating calls.

`POST /api/v2/runs/{id}/execute` durably queues approved work. PostgreSQL workers claim queued records atomically using `FOR UPDATE SKIP LOCKED`; in-memory development uses the same queue contract without cross-process durability. Queue concurrency is bounded per process, not cluster-wide. A queued media run is affined to the worker holding its memory-only pixels, and another worker cannot claim it. If that worker restarts, the recovered run requires re-upload. An interrupted run is never automatically requeued. `POST /api/v2/runs/{id}/restart` requires `confirmed: true`, an `actorRef`, and purpose `RESTART_INTERRUPTED_COGNITIVE_RUN_WITH_POSSIBLE_DUPLICATE_CALLS`. The previous step ledger and safe transmission manifest are retained in attempt history. Recovered media work is ineligible because image pixels and model-derived visible text are intentionally memory-only.

`/health` returns the active knowledge version, manifest hash, source, and entry counts. A missing, unreachable, malformed, incomplete, or hash-invalid production knowledge snapshot prevents startup.

PostgreSQL remains optional for local development. Production integration must additionally apply tenant isolation, encryption, backup and retention policies, database authorization, operational migration controls and append-only human-decision auditing. The current schema establishes durable checkpoints and leases; it does not claim those enterprise platform controls.
