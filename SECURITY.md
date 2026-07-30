# Security model

Report vulnerabilities privately to the repository owner; do not include credentials, personal data, or confidential customer material in a public issue.

The MVP processes text in memory and does not persist uploads. It rejects unsafe source paths, limits request bodies to 25 MB, applies browser security headers, redacts detected secret values from evidence, and treats uploaded text as evidence rather than instruction.

Before production use, add authenticated tenant access, rate limiting, malware/archive handling if binary uploads are introduced, retention controls, encrypted persistence if results are stored, centralized audit logging, dependency scanning, SAST/DAST, independent penetration testing, prompt-injection regression cases, and a tested incident-response procedure.

Formal approval is deliberately out of scope. A source marked as human review or approval can reach at most `HUMAN_VALIDATED` when it names a non-engine actor and an allow-listed human authority. `FORMALLY_APPROVED` is unreachable through the public assessment API. Production identity, authority, signature, scope, and validity verification are required before a future trusted decision connector may create that state.
