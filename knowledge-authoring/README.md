# Category-by-category Knowledge Base production

The authoring JSON is canonical. Category PDFs and the five runtime collections are generated views; do not maintain them independently.

## One category cycle

1. Copy the complete `example/A1_v1.0.json` and `example/AP-A1_v1.0.json` pair.
2. Replace every object, question, test, evidence, finding and mapping ID with the new category IDs.
3. Reuse or extend the single global Tactic Catalog. Keep mappings reciprocal in both category files and the catalog.
4. Add structured normative mappings with exact official URL, locator, rationale and verification date.
5. Validate the complete authoring directory.
6. Generate the combined human PDF from the validated JSON and review it.
7. Freeze the pair version before proceeding to the next pair.

Canonical lifecycle stages are `QUALIFICATION_AND_REGISTRATION`, `DESIGN_AND_DEVELOPMENT`, `VERIFICATION_AND_VALIDATION`, `DEPLOYMENT`, `OPERATION_AND_MONITORING`, `REVIEW_AND_EVALUATION` and `RETIREMENT`. Controlled pilot is an operating boundary; material change is a reassessment trigger.

Every category must explicitly provide `runtime_severity`, `runtime_signals`, and preferably `runtime_applicability`. These fields prevent the compiler from guessing deterministic behavior from prose.

## Commands

```powershell
pnpm kb:validate -- --input "C:\path\to\authoring"
pnpm kb:render -- --input "C:\path\to\authoring" --out "C:\path\to\human-pdfs"
pnpm kb:compile -- --input "C:\path\to\authoring" --out "C:\path\to\runtime" --version "vivicta-governance-1.0.0" --release-status APPROVED
pnpm kb:manifest -- --input "C:\path\to\runtime" --urls "C:\path\to\blob-urls.json" --version "vivicta-governance-1.0.0" --release-status APPROVED
```

Use `--compat --allow-calibration` only for calibration of legacy packages. Compatibility mode maps legacy lifecycle labels, permits source-ID-only mappings, and infers missing runtime fields with visible warnings. It is not a production approval path.

## Release order

1. Run strict validation across all 60 assessment objects, the global Tactic Catalog and source register.
2. Compile and inspect the five runtime collections.
3. Generate and review the 30 category PDFs and the Tactic Playbook PDF.
4. Upload the five runtime JSON files to Vercel Blob and record their exact immutable URLs.
5. Copy `blob-urls.example.jsonc` to a release-specific `.json` file outside the authoring input directory and replace every placeholder with the exact immutable Blob URL.
6. Generate `runtime-manifest.json` last. The generator hashes the exact uploaded-file bytes and rejects placeholder URLs or changed files.
7. Upload the manifest and configure Railway's `VERCEL_KB_MANIFEST_URL`.
8. Verify `/health`, `/api/knowledge`, `/api/knowledge/diagnostics`, then run representative assessments.

Human PDFs may be stored in the same Blob store, but they are intentionally absent from the runtime manifest.
