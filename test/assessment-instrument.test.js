import test from "node:test";
import assert from "node:assert/strict";
import { domainPrompt, PROMPT_VERSIONS } from "../src/cognitive/prompts.js";
import { assessmentWorkItems, knowledgeAssessmentIndex, stampCanonicalObjectIds } from "../src/cognitive/integrity.js";
import { loadKnowledgeSnapshot } from "../src/knowledge/provider.js";
import { ASSESSMENT_PAIRS } from "../src/knowledge/assessment-instrument.js";
import { selectPlaybookActions } from "../src/core/playbook-engine.js";
import { TACTICS } from "../src/knowledge/playbook.js";

const dossier = { currentStage: "DESIGN_AND_DEVELOPMENT", targetStage: "DESIGN_AND_DEVELOPMENT" };

test("the Categories instrument is 30 pairs with three questions each and no invented KB fields", () => {
  assert.equal(ASSESSMENT_PAIRS.length, 30);
  const ids = ASSESSMENT_PAIRS.map((item) => item.id);
  assert.deepEqual(ids, ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3", "C4", "C5", "D1", "D2", "D3", "D4", "D5", "E1", "E2", "E3", "E4", "E5", "F1", "F2", "F3", "F4", "F5"]);
  for (const pair of ASSESSMENT_PAIRS) {
    assert.equal(pair.questions.length, 3);
    assert.equal(pair.antipattern.questions.length, 3);
    assert.equal(pair.antipattern.id, `AP-${pair.id}`);
    assert.equal(pair.questions[0].id, `${pair.id}-Q1`);
    assert.equal(pair.antipattern.questions[0].id, `AP-${pair.id}-Q1`);
    assert.equal(pair.questions[0].dimension, "DEFINITION_AND_INTENT");
    assert.equal(pair.questions[1].dimension, "IMPLEMENTATION_AND_OPERATION");
    assert.equal(pair.questions[2].dimension, "EVIDENCE_AND_EFFECTIVENESS");
  }
});

test("analysis work items are the 60 taxonomy objects and 180 questions", async () => {
  const knowledge = await loadKnowledgeSnapshot({ production: false, manifestUrl: "" });
  const items = ["A", "B", "C", "D", "E", "F"].flatMap((domain) => assessmentWorkItems(knowledge, dossier, domain));
  const questions = items.filter((item) => item.kind === "ASSESSMENT" && /Q\d$/.test(item.objectId));
  assert.ok(items.some((item) => item.objectId === "CTRL-A1"));
  assert.ok(items.some((item) => item.objectId === "A1-Q1"));
  assert.ok(items.some((item) => item.objectId === "AP-A1"));
  assert.ok(items.some((item) => item.objectId === "AP-A1-Q1"));
  assert.ok(items.some((item) => item.objectId === "CTRL-F5"));
  assert.ok(items.some((item) => item.objectId === "AP-F5-Q3"));
  assert.equal(items.some((item) => item.objectId === "CTRL-A-01"), false);
  assert.equal(questions.length, 180);
  const a1q1 = items.find((item) => item.objectId === "A1-Q1");
  assert.equal(a1q1.dimension, "DEFINITION_AND_INTENT");
  assert.match(a1q1.question, /intended purpose and decision context/);
  const apA1q2 = items.find((item) => item.objectId === "AP-A1-Q2");
  assert.equal(apA1q2.dimension, "IMPLEMENTATION_AND_OPERATION");
});

test("domain prompt 3.1.0 tells the model to assess instrument questions and stamp A1 / AP-A1 IDs", () => {
  assert.equal(PROMPT_VERSIONS.domain, "domain-assessment-3.1.0");
  const prompt = domainPrompt({
    domain: "A",
    dossier,
    solutionModel: { facts: [] },
    packets: [{ sourceUnits: [] }],
    controls: [{ id: "CTRL-A1", authoringObjectId: "A1", questions: [{ id: "A1-Q1", question: "Is the intended purpose and decision context specific, bounded and testable?" }] }],
    requirements: [],
    antiPatterns: [{ id: "AP-A1", questions: [{ id: "AP-A1-Q1" }] }],
    assessmentWorkItems: [{ objectId: "A1-Q1", kind: "ASSESSMENT", title: "Is the intended purpose and decision context specific, bounded and testable?" }]
  });
  assert.match(prompt, /A–F assessment instrument/);
  assert.match(prompt, /exact wording to assess/);
  assert.match(prompt, /Do not invent evidence rules, atomic tests, finding-definition IDs/);
  assert.match(prompt, /parent assessment-object ID \(A1, B2, …\)/);
  assert.match(prompt, /A1-Q1/);
  assert.match(prompt, /Is the intended purpose and decision context specific, bounded and testable\?/);
});

test("stamping CTRL-A1 onto a claim carries A1 so the Playbook can retrieve", async () => {
  const knowledge = await loadKnowledgeSnapshot({ production: false, manifestUrl: "" });
  const claim = stampCanonicalObjectIds({
    controlIds: ["CTRL-A1"],
    antiPatternIds: ["AP-A1"],
    assessmentObjectIds: ["A1-Q1"],
    requirementIds: [],
    findingDefinitionIds: []
  }, knowledge);
  assert.ok(claim.assessmentObjectIds.includes("A1"));
  assert.ok(claim.assessmentObjectIds.includes("A1-Q1"));
  const fromQuestion = stampCanonicalObjectIds({
    controlIds: [],
    antiPatternIds: [],
    assessmentObjectIds: ["A1-Q1"],
    requirementIds: [],
    findingDefinitionIds: []
  }, knowledge);
  assert.ok(fromQuestion.assessmentObjectIds.includes("A1"));
  assert.ok(fromQuestion.controlIds.includes("CTRL-A1"));
  const fromAntiPatternQuestion = stampCanonicalObjectIds({
    controlIds: [],
    antiPatternIds: [],
    assessmentObjectIds: ["AP-A1-Q2"],
    requirementIds: [],
    findingDefinitionIds: []
  }, knowledge);
  assert.ok(fromAntiPatternQuestion.antiPatternIds.includes("AP-A1"));
  assert.equal(fromAntiPatternQuestion.controlIds.includes("CTRL-A1"), false);
  const index = knowledgeAssessmentIndex(knowledge);
  assert.ok(index.assessmentObjects.has("A1"));
  assert.ok(index.assessmentObjects.has("A1-Q1"));
  assert.ok(index.assessmentObjects.has("AP-A1"));
  assert.ok(index.antiPatterns.has("AP-A1"));
  const actions = selectPlaybookActions(TACTICS, [{
    id: "finding-a1",
    statement: "Purpose boundary is not established.",
    findingDefinitionIds: [],
    assessmentObjectIds: claim.assessmentObjectIds,
    antiPatternIds: claim.antiPatternIds,
    evidenceLinks: [{ id: "link-1" }]
  }]);
  assert.ok(actions.some((item) => item.tacticId === "TAC-PURPOSE-A1-01"));
});
