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
