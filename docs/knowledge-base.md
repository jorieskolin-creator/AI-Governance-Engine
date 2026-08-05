# Vercel knowledge-base contract

Production knowledge is loaded from `VERCEL_KB_MANIFEST_URL`. The manifest and every referenced JSON file should be immutable/versioned Vercel Blob objects. Publishing a new manifest version is the controlled release event.

```json
{
  "schemaVersion": "1.0.0",
  "version": "ai-governance-approved-2026-08-01",
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

## Authoring and compilation

Rich capability, anti-pattern and tactic JSON must not be uploaded as direct runtime collections. Use the category authoring toolchain documented in [knowledge-authoring/README.md](../knowledge-authoring/README.md):

1. Produce and validate one capability/anti-pattern pair at a time.
2. Maintain one shared Tactic Catalog and reciprocal tactic references.
3. Generate human PDFs from the canonical JSON.
4. Validate all 60 objects together.
5. Compile the approved authoring package into the five governance collections plus the versioned assessment-intake questionnaire.
6. Upload those five exact files and generate the runtime manifest last from their immutable URLs and byte hashes.

The compiler preserves rich authoring metadata as additive fields while emitting the existing runtime keys. Lifecycle-specific assurance targets are retained in `targetStateByLifecycle`; the Engine selects the target for the requested transition and falls back to `targetState` for older collections.

Normative mappings include official links, exact locators, authority type, rationale and verification date. Links establish provenance only. They do not establish that the organizational interpretation is legally correct, current or formally approved. Licensed standards remain metadata-only unless storage and machine use are authorized.
