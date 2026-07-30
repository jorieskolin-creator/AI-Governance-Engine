# Railway deployment

1. Connect `jorieskolin-creator/AI-Governance-Engine` to a Railway service.
2. Set the root directory to the repository root and use the checked-in `railway.json`.
3. Configure `NODE_ENV=production`.
4. Configure `VERCEL_KB_MANIFEST_URL` to the immutable, approved Vercel knowledge manifest.
5. Configure `BLOB_READ_WRITE_TOKEN` only if the Blob objects require bearer authentication.
6. Optionally set `ALLOWED_ORIGIN` to the Railway public URL.
7. Deploy. Railway executes `npm run check`, starts `npm start`, and probes `/health`.

## Enabling v2 safely

Keep `COGNITIVE_PIPELINE_ENABLED=false` until the following are configured:

1. Set a long random `COGNITIVE_API_TOKEN`. All v2 endpoints require this bearer token.
2. Keep provider keys server-side: `OPENAI_API_KEY` (preferred) or `GPT_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`.
3. Run `npm run benchmark:models` in a controlled environment with `BENCHMARK_CONFIRM_LIVE_CALLS=true` and review the output against the qualification floors.
4. Add only qualified profile IDs to `MODEL_PROFILE_APPROVALS`.
5. Set `COGNITIVE_PIPELINE_ENABLED=true` and redeploy.

The service will not run pilot profiles in production. A run also fails closed when the user has not approved a provider for every packet, cross-provider verification cannot be performed, a required model stage fails, or the model budget is exhausted.

The pilot run store is in memory. Raw evidence expires after 60 minutes and is purged after success, failure, cancellation, or timeout. A Railway restart invalidates in-progress runs and requires re-upload. Persisting packages or queues is a later production-hardening step, not part of this vertical slice.

`/health` returns the active knowledge version, manifest hash, source, and entry counts. A missing, unreachable, malformed, incomplete, or hash-invalid production knowledge snapshot prevents startup.

No database is required for the MVP. If readiness packages later require persistence, store the canonical package and source hashes separately from uploaded source content, apply tenant isolation, retention, encryption, and access-control requirements, and record human decisions as append-only events.
