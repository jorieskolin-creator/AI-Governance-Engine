# Evidence Acquisition Phase Handoff

## Purpose

This document transfers the next implementation phase into a fresh Amp thread and Orb. Evidence Acquisition and Intake completion are now the critical path. Do not deepen the cognitive Analysis pipeline until the acquisition acceptance criteria in this document pass.

The governing privacy rule remains unchanged: raw documents, source code, configuration, archive bytes, spreadsheet cells and values, unrestricted OCR text, and image pixels remain local. GenAI may receive only versioned, validated, privacy-safe contracts. The user is the only authority that can select **Approve Filled Information and Continue to Analysis**.

## Repository state at handoff

- Repository: `jorieskolin-creator/AI-Governance-Engine`
- Branch: `main`
- Baseline before this handoff document: `1a5077f`
- Provider set: OpenAI, xAI/Grok, and Moonshot/Kimi only; no Gemini work
- Roles:
  - `WORKHORSE`: retrieval planning, semantic routing, and routine domain assessment; source extraction is deterministic and local
  - `REASONER`: editable Intake proposals, solution understanding, adjudication, and synthesis
  - `QUALITY_CHECKER`: verification and fact-checking
- The live Railway configuration has all three provider credentials and six configured role slots. Configured `WORKHORSE`, `REASONER`, and `QUALITY_CHECKER` routes execute directly; no separate model-profile approval variable is used.
- At the last completed validation, 193 tests passed and the production dependency audit was clean.

Confirm the actual `origin/main`, working tree, tests, and live non-secret readiness before relying on these observations.

## Implemented foundation

- Versioned local acquisition lanes for documents, code/configuration, CSV/XLSX, and media metadata
- Local DLP and prompt-injection screening
- Privacy-safe derived summaries and acquired-fact selection contracts
- Editable GenAI proposals with accepted, edited, and declined states
- User-only immutable Intake approval
- PostgreSQL-safe checkpoints, leases, queue claims, recovery, cancellation, and bounded sequencing
- Seven-step cognitive ledger and provider-neutral response schemas
- OpenAI, xAI, and Moonshot adapters with model identity validation
- Three-role routing, cross-provider verification, third-provider adjudication, and fail-closed topology/credential validation
- Final readiness-package runtime validation and initial published JSON Schema
- Real HTTP workflow test and non-secret deployment readiness surfaces

## Test finding that changed priority

The user tested the Engine with the FinOps materials listed below. Reproduction with the four HTML files produced:

- four documents parsed successfully;
- meaningful high-level topic summaries;
- zero deterministic Intake fields;
- zero questionnaire answers;
- zero GenAI-eligible acquired facts; and
- no blocking DLP finding.

The ZIP is currently classified as an unsupported binary and is not opened. When it was expanded and submitted as a folder, 186 files parsed, but only a conflicting solution-name candidate was found and no questionnaire answers were acquired.

Root causes verified in the implementation:

1. ZIP input is excluded rather than safely expanded or clearly treated as a source-container limitation.
2. Deterministic discovery primarily accepts exact line-level labels such as `Solution name:` or `Intended purpose:`; ordinary architecture prose does not satisfy it.
3. Inert HTML extraction removes all script blocks. Some standalone reports store substantial structured content in embedded scripts, which is therefore not inspected.
4. Document provider summaries intentionally expose topic categories but no names, values, source text, or quotes. They are privacy-safe but too coarse to support factual GenAI Intake proposals.
5. The current `discovery-recheck` asks GenAI for field proposals even though its safe packet often contains insufficient field-level evidence.
6. Full cognitive analysis is no longer blocked by a separate model-qualification gate; configured credentials, topology, evidence authorization, schema validation and budgets remain enforced.

This behavior is consistent with current safeguards but is not sufficient for the intended enterprise evidence workflow. It is not caused by the unfinished Knowledge Base; Intake acquisition occurs before Knowledge Base analysis.

## Required user-provided test materials

The new thread must not modify code until the user confirms that these URLs are the authorized regression inputs or attaches replacements:

1. FinOps repository archive  
   `https://ampcode.com/user-content/attachments/0dfc8cb31c26d43e0d8cb659f2295b0f3888a4c8771dd39eb8cbdfaea0f90482-finops-engine-2026-main.zip`
2. Current architecture  
   `https://ampcode.com/user-content/attachments/0b75f79e1c298666e20111f42cf99791ff7d9b290de8c9814dec6afe5996248f-FinOps-Engine-Current-Architecture.html`
3. Tactic playbook  
   `https://ampcode.com/user-content/attachments/d2cdd68b9bbab5d94e79457a3b92b2fa596c8ed92924eeac0aeba60018f49403-FinOps-Tactic-Playbook-KB-Aligned-Remediation-Patterns.html`
4. Evidence Acquisition design  
   `https://ampcode.com/user-content/attachments/8993bea8ef6bc3c4201f2dfc8e2fe493fad5a002f0e4e2533475de7809ebdec5-FinOps-Engine-Customer-Evidence-Acquisition-Pipeline.html`
5. Master Data report  
   `https://ampcode.com/user-content/attachments/63d9752d664b91ae8d13b07caca0379e4ca5046adaf962d834cd13d85e42e501-FinOps_Master_Data_2026-08-18-1.html`

Do not commit these customer/reference artifacts or extracted raw content. Download them to temporary storage only after authorization. Derive small synthetic or sanitized regression fixtures that preserve the failure mode without retaining sensitive source material.

### Authority classification of the FinOps materials

The FinOps materials are **non-authoritative design inspiration and regression inputs only**. They describe another solution and must not become normative knowledge, AI Governance case evidence, product requirements, or a source of governance conclusions for this Engine.

- Do not copy FinOps domain rules, schemas, thresholds, technology choices, terminology, or pipeline stages merely because they appear in these materials.
- Adopt a pattern only after independently establishing that it fits this Engine's purpose, existing contracts, privacy boundary, and user-approved architecture.
- Use the materials to reproduce messy-source acquisition characteristics and the observed failure mode, not to establish expected Intake values or a correct assessment outcome.
- Committed synthetic fixtures may preserve only the minimum structural characteristic needed for a test; they must not reproduce FinOps customer content or encode FinOps conclusions as expected facts.
- Sources of authority remain the user's explicit decisions, this repository's approved contracts and invariants, and the separately governed AI Governance Knowledge Base when finalized.
- When FinOps material conflicts with an Engine contract or user decision, the Engine contract or user decision prevails and the conflict must be surfaced rather than harmonized silently.

## Refined implementation plan

Current status: Phase 1 items 1–9 are implemented, including the privacy-safe `semantic-intake-evidence-1.0.0` projection, normalized `WORKHORSE` retrieval suggestions and field-applicable `REASONER` proposals. Automated synthetic acceptance verifies that raw documents, code and private values remain local and that proposals do not mutate Intake. Representative end-to-end runs remain necessary to evaluate acquisition quality and model behavior.

### Phase 1 — Evidence Acquisition and Intake completion

Implement each item as a small, independently validated and reviewable change.

1. **Acceptance fixtures and acquisition diagnostics**
   - Reproduce the authorized inputs.
   - Distinguish selected, accepted, parsed, content-extracted, Intake-useful, excluded, failed, privacy-blocked, and GenAI-unavailable states.
   - Surface technical loss separately from genuine source silence.

2. **Safe source containers and structure-preserving HTML**
   - Either clearly require ZIP extraction or implement bounded local ZIP expansion with path-traversal, symlink, entry-count, nested-archive, expansion-size, and compression-ratio protections.
   - Parse HTML inertly while preserving title, headings, lists, tables, sections, and source locators.
   - Inspect supported embedded JSON/data structures locally without executing JavaScript.

3. **PDF, visual, and OCR acquisition lane**
   - Detect sparse or scanned pages.
   - Perform bounded local OCR with page, bounding-box, engine, language, and confidence provenance.
   - Run complete OCR output through DLP locally.
   - Keep pixels and unrestricted OCR text outside provider packets.
   - Low-confidence OCR remains `UNKNOWN` or `REVIEW_REQUIRED`.

4. **Versioned deterministic Intake search registry**
   - Define field-specific labels, aliases, headings, evidence types, source priorities, and extraction strategies.
   - Cover manifests, README content, ownership/RACI tables, architecture sections, structured reports, and canonical declarations.
   - Preserve conflicting candidates rather than selecting one silently.

5. **Privacy-safe Intake candidate contract**
   - Include field ID, sanitized candidate, source references, extraction method, confidence, conflicts, and limitations.
   - Apply field-level disclosure policy before any provider eligibility.
   - Keep raw material and unrestricted free text local.

6. **Deterministic gap analyzer**
   - Measure missing fields, attempted methods, parser/source coverage, technical loss, and safe topic/concept coverage.
   - Decide deterministically whether bounded retrieval could recover information.
   - Genuine silence remains `UNKNOWN`.

7. **Optional GenAI retrieval planner**
   - Route through `WORKHORSE` using a strict provider-neutral schema.
   - Send only missing field definitions, safe metrics, artifact classes, attempted methods, and controlled topic signals.
   - Permit suggestions for search concepts, aliases, source priorities, and local extraction strategies only.
   - Prohibit facts, field values, classifications, findings, or approvals in planner output.

8. **Local bounded re-read**
   - Execute the retrieval plan locally against already approved raw source objects.
   - Limit iterations and work size.
   - Re-enter DLP, sanitization, candidate validation, and packet hashing after every pass.

9. **Proposal and UI integration**
   - Generate optional editable proposals only from validated field-mapped semantic observations or user-selected controlled facts.
   - Preserve document, code and configuration representations separately and defer every comparison to Analysis.
   - Return no proposal when the safe package does not support the missing field.
   - Clearly distinguish deterministic observations, conflicts, GenAI retrieval suggestions, GenAI value proposals, user edits, and unknowns.
   - Preserve the user-only final approval boundary.

10. **End-to-end acceptance**
    - Re-run the authorized FinOps scenario.
    - Recover useful candidates where evidence supports them, expose conflicts, and preserve genuine unknowns.
    - Prove that archives, HTML source, code, OCR text, spreadsheet values, and pixels do not reach providers.
    - Verify eligible failures use only authorized fallbacks and that cancellation, lease loss and Engine budget exhaustion do not switch providers.

### Phase 2 — Resume remaining prior-plan work

Begin only after Phase 1 acceptance passes:

1. Complete nested readiness-package schemas and published integration contracts.
2. Integrate and validate the evolving Knowledge Base taxonomy and release artifacts without treating incomplete content as complete.
3. Exercise the six configured model-role slots in controlled Engine runs and retain provider/model provenance.
4. Run controlled end-to-end cognitive golden cases and evaluate precision, recall, cost, and failure behavior.
5. Add monitoring, aggregate budgets, retention controls, operational audit export, and deployment hardening.
6. Keep enterprise authentication and tenant authorization deferred to the integrating platform unless the user changes that decision.

## Non-negotiable invariants

- No Gemini implementation or configuration.
- Raw source material never enters a provider request.
- Customer evidence and Knowledge Base authority remain separate.
- A retrieval plan is not evidence and cannot populate Intake directly.
- A GenAI proposal is not a user decision.
- Only the user can approve the final filled Intake and start Analysis.
- Missing evidence remains `UNKNOWN`; silence does not establish absence or safety.
- Code supports at most implementation evidence unless bounded execution results establish more.
- OCR output is raw evidence until locally screened and transformed.
- Provider differences remain explicit and every output is validated locally.
- Eligible provider failures may use only configured, evidence-authorized fallbacks; cancellation, lease loss and Engine budget exhaustion never do.
- No live provider calls without explicit authorization.

## Instructions for the new thread

1. Read this handoff and inspect `origin/main`.
2. Do not change code, download the referenced artifacts, call providers, or alter Railway configuration yet.
3. Ask the user to confirm or attach the authorized test materials and state whether temporary downloading is approved.
4. Wait for the user's response.
5. After authorization, begin only with Phase 1, item 1. Establish synthetic/sanitized regression fixtures and measurable acceptance criteria before changing acquisition behavior.
