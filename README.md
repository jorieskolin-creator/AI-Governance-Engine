# Vivicta AI Governance Engine

Standalone, evidence-gated readiness assessment for AI solutions. The engine accepts an intended-use dossier, a codebase/source packet, and supporting evidence. It produces a structured readiness package that explains what is supported, unknown, contradictory, blocked, and required next.

This is a clean governance implementation inspired by the FinOps Engine's processing pattern. It contains no FinOps criteria, maturity model, scoring, personas, prompts, tactics, or terminology.

## What the engine does

- Registers and hashes every submitted source.
- Scans code, configuration, tests, reviews, and operational records for governance-relevant signals.
- Evaluates six governance domains across seven lifecycle stages.
- Separates evidence coverage, control assurance, residual risk, and hard-gate status.
- Preserves silence as `UNKNOWN`; it never treats missing evidence as proof of safety or compliance.
- Selects approved governance actions only from verified findings.
- Produces a JSON readiness package and an interactive dashboard.
- Records required human authorities without issuing formal approval.

## Run

Node.js 20 or newer is the only dependency.

```powershell
npm test
npm start
```

Open `http://localhost:4174`. Use **Load credible sample** to inspect the complete output or fill the dossier and upload a code folder.

## API

`POST /api/assess`

```json
{
  "dossier": {
    "name": "Internal knowledge assistant",
    "intendedPurpose": "Answer employee questions from approved internal material",
    "expectedValue": "Reduce support handling time",
    "currentStage": "DESIGN_AND_DEVELOPMENT",
    "targetStage": "VERIFICATION_AND_VALIDATION",
    "jurisdictions": ["EU"],
    "roles": ["DEPLOYER"],
    "users": ["EMPLOYEES"],
    "accountableOwner": "Solution owner",
    "data": { "personalData": false, "specialCategoryData": false, "productionData": false },
    "exposure": { "externalUsers": false, "productionAccess": false, "consequentialDecisions": false },
    "agent": { "usesAgents": true, "canTakeActions": false, "irreversibleActions": false, "humanOverride": true },
    "classification": { "prohibitedPractice": false, "highRiskCandidate": false }
  },
  "sources": [
    { "path": "src/assistant.js", "content": "...", "kind": "CODE" },
    { "path": "test/assistant.test.js", "content": "...", "kind": "TEST" }
  ]
}
```

`GET /api/sample` returns a complete sample request. `GET /api/knowledge` returns the active, versioned knowledge manifest.

## Human authority boundary

The engine emits one of:

- `READY_FOR_NEXT_STAGE`
- `READY_WITH_CONDITIONS`
- `REMEDIATE_BEFORE_NEXT_STAGE`
- `HUMAN_REVIEW_REQUIRED`
- `BLOCKED_IN_CURRENT_FORM`

These are readiness recommendations. `LEGAL`, `PRIVACY`, `SECURITY`, `GOVERNANCE`, `AI_FORUM`, and `AI_BOARD` decisions remain human acts. The engine has no API that can create a formal approval, and its output contract identifies the authority required for every unresolved decision.

The `FORMALLY_APPROVED` assurance state is reserved for a future trusted decision connector that verifies human identity, authority, signature, decision scope, and validity. The public assessment API caps a caller-supplied approval artifact at `HUMAN_VALIDATED`; it cannot self-assert or import formal authorization by metadata alone.

## Knowledge governance

The bundled catalogue is a pilot baseline, not legal advice. Normative sources carry authority type, effective dates, official URLs, and human-approval status. Production use requires provision-level mappings to be approved and maintained by the accountable Legal, Privacy, Security, and Governance owners.
