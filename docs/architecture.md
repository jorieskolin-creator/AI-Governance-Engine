# Architecture

## Decision-ready reporting

The canonical readiness package is the only source of truth. Source-first intake first builds a content-addressed `SourceIngestionManifest 1.0.0`, then a field-level `solutionProfile`, immutable `assessmentIntake 1.2.0`, and deterministic `documentationReadiness` before governance assessment. The engine then builds `transitionBoundary`, enriched hard gates, and the `assuranceSummary 1.3.0` view model before any cognitive synthesis. The browser renders two views over that same package:

- **Assessment Workspace** for intake, detailed controls, evidence, execution diagnostics, and remediation work.
- **Assurance Summary** for owners, executives, and formal reviewers.

The summary renderer does not calculate readiness. Live HTML and printable PDF use the same ordered report-section markup; only pagination and interactive controls differ. The downloadable HTML is self-contained, has embedded CSS, contains no executable scripts or external assets, and escapes all untrusted values. It contains no Evidence Digest or raw excerpts. JSON remains the complete canonical audit record.

For `ReadinessPackageV2` 2.4.0, synthesis emits traceable `NarrativeItem` records. Item-level fact-checking either supports, corrects, or quarantines each item. If synthesis or fact-checking fails, the Engine renders a deterministic-only summary and raises `COGNITIVE_ASSESSMENT_INCOMPLETE` rather than suppressing the report. The deterministic fallback package remains available as schema 1.3.0.

The AI Governance Engine is a standalone evidence-processing service. It reuses the useful shape of the FinOps Engine—parallel domain assessment, evidence verification, hard gates, controlled synthesis, traceability, and targeted action selection—without importing any FinOps domain model.

```mermaid
flowchart LR
  D["Untrusted sources"] --> P["Local parse, DLP and provenance"]
  P --> I["Cited intake draft and user confirmation"]
  I --> S["Locked solution understanding"]
  S --> A["Parallel A-F candidate claims"]
  A --> V["Independent verification and targeted rescan"]
  V --> L["Locked findings only"]
  K["Versioned Vercel knowledge manifest"] --> G["Deterministic applicability, controls and hard gates"]
  L --> G
  G --> T["Exact approved playbook mapping"]
  G --> Y["Controlled synthesis"]
  T --> Y
  Y --> F["Independent narrative fact-check"]
  F --> O["Canonical ReadinessPackageV2"]
  O --> H["Named human authorities"]
```

## Trust boundaries

- Uploaded content is untrusted evidence, not executable instruction. Raw bytes are memory-only; redacted excerpts, hashes, claims, findings, model traces, and the package may survive the run.
- A packet is sent only after explicit packet/provider approval. The trace records provider, model, parameters, prompt/schema version, packet hash, usage, latency, retries, and output hash without recording credentials.
- Provider disagreement is not resolved by majority vote. Unresolved high/critical disagreement is routed to a named human authority.
- Evidence state is derived from artifact type. Code/configuration can establish only `IMPLEMENTED`; tests and scans can establish `TESTED`; operational records can establish `OPERATIONALLY_OBSERVED`.
- Lexical matches are `AUTOMATED_INDICATOR` records and cannot independently establish `IMPLEMENTED`. User confirmation creates a declaration but cannot manufacture documentary evidence or erase a contradiction.
- Missing critical case information enforces an `ISOLATED_SANDBOX` operating boundary. Deployment and operation require every applicable intake field to be documented, confirmed, and aligned with implementation.
- Known-irrelevant source exclusions remain visible but do not block progression. Unsupported source-like, failed, or unsafe evidence creates `SOURCE_COVERAGE_INCOMPLETE`; early work remains sandboxed and Deployment or later progression fails closed until the gap has scoped, attributable coverage.
- `HUMAN_VALIDATED` and `FORMALLY_APPROVED` require a non-engine actor identifier plus an allow-listed authority.
- Hard gates are deterministic and cannot be overridden by narrative generation.
- Missing cognitive stages create `COGNITIVE_ASSESSMENT_INCOMPLETE`; positive deployment progression fails closed.
- Synthesis sees only locked data. A different-provider fact-check quarantines unsupported prose and cannot alter deterministic results.
- The output is a readiness recommendation. Approval, legal interpretation, privacy review, security acceptance, residual-risk acceptance, and deployment authorization remain named human acts.

## Deployment boundary

Railway runs the stateless application and serves the dashboard/API. Vercel hosts immutable, versioned knowledge documents and their manifest. In production, the engine fails closed when it cannot load the manifest or validate every document hash.

The canonical readiness package is the sole output contract. PDF, HTML, or a later Saidot connector should render or transfer that package rather than calculate a second result.
