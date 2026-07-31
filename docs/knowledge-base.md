# Vercel knowledge-base contract

Production knowledge is loaded from `VERCEL_KB_MANIFEST_URL`. The manifest and every referenced JSON file should be immutable/versioned Vercel Blob objects. Publishing a new manifest version is the controlled release event.

```json
{
  "schemaVersion": "1.0.0",
  "version": "vivicta-approved-2026-08-01",
  "documents": [
    {
      "id": "normative-sources-2026-08",
      "type": "normativeSources",
      "url": "https://example.public.blob.vercel-storage.com/normative-sources-2026-08.json",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

Exactly one or more documents must collectively populate each type: `normativeSources`, `requirements`, `controls`, `antipatterns`, and `tactics`. A document may be a JSON array or `{ "entries": [...] }`.

The example hash is a placeholder. Calculate the SHA-256 over the exact uploaded bytes. The engine verifies each value before accepting the snapshot. Knowledge entries should carry stable IDs, versions, authority classification, effective dates, owner authority, and approval status where applicable.

The bundled local catalogue is only for development. Railway production requires the Vercel manifest, so it cannot silently fall back to an unapproved local baseline.

## Runtime connection and integrity evaluation

At startup the Engine fetches the manifest and each referenced JSON document, checks the exact SHA-256 value from the manifest, parses the JSON, and validates the combined snapshot. A hash mismatch, missing collection, invalid A-F domain or lifecycle stage, duplicate stable ID, or broken requirement/control/source reference fails startup rather than falling back silently.

`GET /api/knowledge` returns the sanitized connection identity, release status, manifest hash, entry counts and diagnostic summary. `GET /api/knowledge/diagnostics` returns the full non-secret diagnostic record, including per-document hash-verification status and cross-document issues. The web intake displays the same status. A calibration, pilot or draft release remains visibly non-authoritative even when all integrity checks pass.

Diagnostic status meanings:

- `PASS`: structural, hash and cross-reference checks passed and the release is approved.
- `WARN`: the snapshot is usable for calibration, but contains a non-blocking issue such as a non-approved release or an unmapped tactic.
- `FAIL`: integrity or referential checks failed; the snapshot is rejected and the Engine does not start with it.
