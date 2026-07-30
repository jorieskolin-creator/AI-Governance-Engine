# Railway deployment

1. Connect `jorieskolin-creator/AI-Governance-Engine` to a Railway service.
2. Set the root directory to the repository root and use the checked-in `railway.json`.
3. Configure `NODE_ENV=production`.
4. Configure `VERCEL_KB_MANIFEST_URL` to the immutable, approved Vercel knowledge manifest.
5. Configure `BLOB_READ_WRITE_TOKEN` only if the Blob objects require bearer authentication.
6. Optionally set `ALLOWED_ORIGIN` to the Railway public URL.
7. Deploy. Railway executes `npm run check`, starts `npm start`, and probes `/health`.

`/health` returns the active knowledge version, manifest hash, source, and entry counts. A missing, unreachable, malformed, incomplete, or hash-invalid production knowledge snapshot prevents startup.

No database is required for the MVP. If readiness packages later require persistence, store the canonical package and source hashes separately from uploaded source content, apply tenant isolation, retention, encryption, and access-control requirements, and record human decisions as append-only events.
