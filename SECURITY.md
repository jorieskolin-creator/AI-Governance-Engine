# Security model

Report vulnerabilities privately to the repository owner; do not include credentials, personal data, or confidential customer material in a public issue.

The engine processes uploads in memory and does not persist raw files. It rejects unsafe source and archive paths, limits request and per-source sizes, screens Office archives for macros and suspicious expansion, ignores spreadsheet formulas, disables PDF evaluation, applies browser security headers, redacts detected secret and personal-data patterns, and treats uploaded content as evidence rather than instruction. Unscreened images cannot be transmitted.

The cognitive endpoints are feature-flagged, bearer-authenticated, rate-limited, budgeted, and server-side only. Every evidence-bearing provider call requires explicit packet/provider approval and creates a transmission manifest. Models receive no tools, web access, or code-execution capability. Provider refusal, invalid schema, disagreement, or missing coverage fails closed.

Before multi-tenant production use, replace the single service token with tenant identity and authorization, add malware scanning, centralized audit logging, encrypted result persistence if required, dependency/SAST/DAST scanning, independent penetration testing, provider data-processing approval, prompt-injection regression cases, and a tested incident-response procedure.

Formal approval is deliberately out of scope. A source marked as human review or approval can reach at most `HUMAN_VALIDATED` when it names a non-engine actor and an allow-listed human authority. `FORMALLY_APPROVED` is unreachable through the public assessment API. Production identity, authority, signature, scope, and validity verification are required before a future trusted decision connector may create that state.
