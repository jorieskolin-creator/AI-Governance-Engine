# Vercel knowledge-base contract

When `VERCEL_KB_MANIFEST_URL` is set, production knowledge is loaded from that URL. The manifest and every referenced JSON file should be immutable/versioned Vercel Blob objects. Publishing a new manifest version is the controlled release event. Leave the variable unset until that manifest exists: the Engine then starts with the local unpublished snapshot instead of failing.

```json
{
  "schemaVersion": "1.1.0",
  "version": "ai-governance-approved-2026-08-01",
  "releaseStatus": "APPROVED",
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

Exactly one or more documents must collectively populate each type: `normativeSources`, `requirements`, `controls`, `antipatterns`, and `tactics`. `intakeQuestionnaire` is optional. Maintainer collection artifacts use `{ "schemaVersion": "1.0.0", "type": "...", "entries": [...] }`; the loader also accepts a bare array for compatibility.

The example hash is a placeholder. Calculate the SHA-256 over the exact uploaded bytes. The engine verifies each value before accepting the snapshot. Knowledge entries should carry stable IDs, versions, authority classification, effective dates, owner authority, and approval status where applicable.

The bundled local snapshot loads the approved Tactic Playbook and the A–F assessment instrument (30 capabilities, 30 anti-patterns, 3 questions each). Knowledge Base evidence rules, atomic tests, finding definitions and normative clause mappings remain unpublished. Railway production uses this local snapshot whenever `VERCEL_KB_MANIFEST_URL` is unset or blank. Do not point the variable at a placeholder or non-manifest document: a configured URL is fail-closed.

## Runtime connection and integrity evaluation

When a manifest URL is configured, startup fetches the manifest and each referenced JSON document, checks the exact SHA-256 value from the manifest, parses the JSON, and validates the combined snapshot. A hash mismatch, missing collection, invalid A-F domain or lifecycle stage, duplicate stable ID, or broken requirement/control/source reference fails startup rather than falling back silently. When no URL is configured, startup uses the local unpublished snapshot and continues.

`GET /api/knowledge` returns the sanitized connection identity, release status, Playbook completeness, manifest hash, entry counts and diagnostic summary. `GET /api/knowledge/diagnostics` returns the full non-secret diagnostic record, including per-document hash-verification status and cross-document issues. The web intake displays the same status. An unpublished Knowledge Base (missing evidence rules, atomic tests or finding definitions) remains visible even when the assessment instrument and approved Playbook are loaded and all integrity checks pass.

Diagnostic status meanings:

- `PASS`: structural, hash and cross-reference checks passed and the release is approved.
- `WARN`: the snapshot is structurally usable, but contains a non-blocking issue such as an unpublished Knowledge Base (instrument loaded, evidence rules / finding definitions missing) or a non-approved remote release.
- `FAIL`: integrity or referential checks failed; the snapshot is rejected and the Engine does not start with it.

## Producer and activation boundary

The Maintainer owns authoring, governance, publication evidence, Drive archiving and immutable Blob distribution. The Engine owns consumption, activation and runtime diagnostics. `PUBLISHED` therefore means the runtime manifest is available and hash-verified in storage; it does not claim that any Engine deployment has activated it.

Before changing a deployment, run the Engine-owned `verify-knowledge-manifest` GitHub workflow with the immutable manifest URL, or run `VERCEL_KB_MANIFEST_URL=https://... pnpm run kb:verify-runtime` in an authorized environment. Private Blob access uses `BLOB_READ_WRITE_TOKEN`. The verification loads the real Engine provider and requires `APPROVED` plus `PASS` diagnostics without checking out or importing Maintainer code.

## Authoring and compilation

Rich capability, anti-pattern and tactic JSON must not be uploaded as direct runtime collections. Use the category authoring toolchain documented in [knowledge-authoring/README.md](../knowledge-authoring/README.md):

1. Produce and validate one capability/anti-pattern pair at a time.
2. Maintain one shared Tactic Catalog as the source of truth for approved `Primary object / mapping` relationships.
3. Generate human PDFs from the canonical JSON.
4. Validate all 60 objects together.
5. Compile the approved authoring package into six runtime collections: five governance collections plus the versioned assessment-intake questionnaire.
6. Upload those exact files and generate the runtime manifest last from their immutable URLs and byte hashes.

Category authors should start from [kb-human-readable-document-sample.pdf](kb-human-readable-document-sample.pdf). That sample shows the human PDF outline, the schema `2.1.0` field names, and the compiled JSON keys the Engine loads. The Engine does not read the PDF.

The compiler preserves rich authoring metadata as additive fields while emitting the existing runtime keys. Lifecycle-specific assurance targets are retained separately in `minimumTechnicalAssuranceByLifecycle` and `requiredHumanAssuranceByLifecycle`; `targetStateByLifecycle` remains the combined backward-compatible gate target. The Engine selects the target for the requested transition and falls back to `targetState` for older collections.

Authoring schema `2.1.0` is machine-validated before cross-document validation. Candidate tactics are retrieved only when a locked finding's assessed capability or anti-pattern matches an approved Playbook `Primary object / mapping`. Signal, domain, keyword and similarity matches are not mapping authority. The assessment package records the exact locked finding, assessment object and selected tactic; selection remains advisory and cannot close a finding or authorize progression.

Normative mappings include official links, exact locators, authority type, rationale and verification date. Links establish provenance only. They do not establish that the organizational interpretation is legally correct, current or formally approved. Licensed standards remain metadata-only unless storage and machine use are authorized.
