import test from "node:test";
import assert from "node:assert/strict";
import { assessSolution } from "../src/engine.js";
import { SAMPLE_REQUEST } from "../src/sample.js";

function scenario(name, changes) {
  const input = structuredClone(SAMPLE_REQUEST);
  input.dossier.name = name;
  Object.assign(input.dossier, changes);
  return input;
}

const cases = [
  ["low-risk internal assistant", {}, ["READY_WITH_CONDITIONS", "REMEDIATE_BEFORE_NEXT_STAGE", "HUMAN_REVIEW_REQUIRED"]],
  ["customer chatbot", { exposure: { externalUsers: true, productionAccess: false, consequentialDecisions: false } }, ["HUMAN_REVIEW_REQUIRED", "REMEDIATE_BEFORE_NEXT_STAGE"]],
  ["HR decision support", { classification: { prohibitedPractice: false, highRiskCandidate: true }, exposure: { externalUsers: false, productionAccess: false, consequentialDecisions: true }, data: { personalData: true, specialCategoryData: true, productionData: false } }, ["HUMAN_REVIEW_REQUIRED"]],
  ["agent with excessive permissions", { agent: { usesAgents: true, canTakeActions: true, irreversibleActions: true, humanOverride: false } }, ["BLOCKED_IN_CURRENT_FORM"]],
  ["personal-data solution", { data: { personalData: true, specialCategoryData: false, productionData: true } }, ["BLOCKED_IN_CURRENT_FORM"]],
  ["prohibited use", { classification: { prohibitedPractice: true, highRiskCandidate: false } }, ["BLOCKED_IN_CURRENT_FORM"]]
];

for (const [name, changes, expected] of cases) {
  test(`golden scenario: ${name}`, async () => {
    const result = await assessSolution(scenario(name, changes));
    assert.ok(expected.includes(result.recommendation.outcome), `${name}: ${result.recommendation.outcome}`);
    assert.equal(result.recommendation.formalApproval, false);
    assert.ok(result.domains.every((domain) => ["A", "B", "C", "D", "E", "F"].includes(domain.id)));
    assert.ok(result.evidence.every((item) => item.path && item.sha256));
    assert.ok(result.actions.every((item) => item.lockedFindingIds.length > 0));
  });
}
