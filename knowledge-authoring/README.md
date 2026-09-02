# Category-by-category Knowledge Base production

The authoring JSON is canonical. Category PDFs and the six runtime collections are generated views; do not maintain them independently.

Schema version `2.1.0` is defined in `schemas/`. Strict validation runs the draft 2020-12 schemas first and then enforces cross-document integrity that JSON Schema cannot express: reciprocal capability/anti-pattern pairs, globally unique atomic IDs, internal question and evidence references, Playbook object mappings, tactic dependencies and source-register resolution.

Stable ID forms are `A1` / `AP-A1`, `A1-Q1` / `AP-A1-Q1`, `A1-SC-001` / `AP-A1-AT-001`, `EVD-A1-001` / `EVD-AP-A1-001`, and `FND-A1-001` / `FND-AP-A1-001`. Tactic IDs use the Playbook namespace, assessment object and two-digit sequence, for example `TAC-PURPOSE-A1-01`. Published IDs are immutable; migrate older example IDs explicitly rather than aliasing them silently.

The bundled A1 pair and source register are structurally complete `DRAFT` examples. The canonical catalog contains all 119 user-approved Playbook tactic definitions. Production compilation still requires all 60 approved assessment objects and the approved source register.

## Human-readable document sample

`docs/kb-human-readable-document-sample.pdf` is the annotated sample for category authors. It follows the A1 / AP-A1 publication outline (package identity, numbered sections 1–12, paired anti-pattern, Engine translation) and maps each human heading to schema `2.1.0` fields and to the compiled runtime keys the Engine actually loads.

The sample is generated from `example/A1_v1.0.json` and `example/AP-A1_v1.0.json`. Canonical JSON remains authoritative; the Engine never reads the PDF. Publication-only prose (runtime decision boundary, extra finding table columns, evidence class/acceptance narrative) is labelled so it is not mistaken for a schema object.

Regenerate after schema or example changes:

```bash
pnpm kb:sample-doc
```

`--out` is a directory, matching the other authoring commands. The default writes `docs/kb-human-readable-document-sample.pdf`. `pnpm kb:sample-doc -- --out /tmp/generated` writes that filename inside the directory.

## One category cycle

1. Copy the complete `example/A1_v1.0.json` and `example/AP-A1_v1.0.json` pair.
2. Replace every object, pair, question, test, evidence, finding and mapping ID with the new category IDs.
3. Use the canonical global Tactic Catalog. Its approved `Primary object / mapping` relationships are the mapping source of truth; category files do not need to duplicate every relationship.
4. Add structured normative mappings with exact official URL, locator, rationale and verification date.
5. Validate the complete authoring directory.
6. Generate the combined human PDF from the validated JSON and review it.
7. Freeze the pair version before proceeding to the next pair.

Canonical lifecycle stages are `QUALIFICATION_AND_REGISTRATION`, `DESIGN_AND_DEVELOPMENT`, `VERIFICATION_AND_VALIDATION`, `DEPLOYMENT`, `OPERATION_AND_MONITORING`, `REVIEW_AND_EVALUATION` and `RETIREMENT`. Controlled pilot is an operating boundary; material change is a reassessment trigger.

Every category must explicitly provide `runtime_severity`, `runtime_signals`, and `runtime_applicability`. These fields prevent the compiler from guessing deterministic behavior from prose. Technical assurance and human assurance remain separate in authoring and in the compiled controls.

The category taxonomy owns assessment and finding definitions. The global Tactic Catalog owns reusable roadmap definitions and their approved `Primary object / mapping` relationships. A locked finding is connected to candidate tactics through its assessed capability or anti-pattern; the assessment result records the exact finding-to-selected-tactic grounding. The source Playbook provides function, control purpose, principal outputs and reassessment targets, but not owners, dependencies, acceptance criteria or dedicated verification procedures, so those fields are not fabricated. Tactic completion has one allowed effect: `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED`. Selection cannot close a finding, accept risk or authorize progression. Case-specific assignees, dates and action state belong to the runtime roadmap, not the reusable catalog.

## Commands

```powershell
pnpm kb:validate -- --input "C:\path\to\authoring"
pnpm kb:render -- --input "C:\path\to\authoring" --out "C:\path\to\human-pdfs"
pnpm kb:compile -- --input "C:\path\to\authoring" --out "C:\path\to\runtime" --version "ai-governance-1.0.0" --release-status APPROVED
pnpm kb:manifest -- --input "C:\path\to\runtime" --urls "C:\path\to\blob-urls.json" --version "ai-governance-1.0.0" --release-status APPROVED
```

Use `--compat` only when migrating legacy authoring JSON: it maps legacy lifecycle labels, permits source-ID-only mappings, and infers missing runtime fields with visible warnings. Use `--allow-unapproved-objects` only to compile a partial workspace that is not a production release. Neither flag is a production approval path. Compile and manifest commands require explicit `--version` and `--release-status`.

## Release order

1. Run strict validation across all 60 assessment objects, the global Tactic Catalog and source register.
2. Compile and inspect the six runtime collections.
3. Generate and review the 30 category PDFs and the Tactic Playbook PDF.
4. Upload the six runtime JSON files to Vercel Blob and record their exact immutable URLs.
5. Copy `blob-urls.example.jsonc` to a release-specific `.json` file outside the authoring input directory and replace every placeholder with the exact immutable Blob URL.
6. Generate `runtime-manifest.json` last. The generator hashes the exact uploaded-file bytes and rejects placeholder URLs or changed files.
7. Upload the manifest and configure Railway's `VERCEL_KB_MANIFEST_URL`.
8. Verify `/health`, `/api/knowledge`, `/api/knowledge/diagnostics`, then run representative assessments.

Human PDFs may be stored in the same Blob store, but they are intentionally absent from the runtime manifest.

See [Human-readable Knowledge Base document sample](../docs/kb-human-readable-document-sample.pdf) for the section outline, schema field names and compiled Engine JSON.
