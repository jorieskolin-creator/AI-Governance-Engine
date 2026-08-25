import test from "node:test";
import assert from "node:assert/strict";
import { createPreflight } from "../src/cognitive/preflight.js";
import { recheckDiscovery } from "../src/cognitive/discovery-recheck.js";
import { modelPolicy } from "../src/cognitive/model-policy.js";
import { ModelBudget, StructuredModelClient } from "../src/cognitive/provider-client.js";
import { SEMANTIC_INTAKE_EVIDENCE_VERSION, validateSemanticIntakeEvidence } from "../src/intake/semantic-intake-evidence.js";

const policy = () => modelPolicy({ MOONSHOT_API_KEY: "test" });

test("controlled semantic Intake observations preserve source separation without raw material or evaluative content", async () => {
  const privateMarker = "Jori Private Portfolio Name";
  const run = await createPreflight({ sources: [
    {
      path: "docs/purpose.md",
      mimeType: "text/markdown",
      content: `${privateMarker} is an interactive CV and conversational assistant designed for recruiters, hiring managers, and potential clients. Features include professional experience questions and answers, a tailored pitch generator, challenge simulator, and reverse interview. Inputs include user questions, job descriptions, and professional experience material. It uses external generative AI and document storage. The service rejects harmful or illegal requests.`
    },
    {
      path: "src/assistant.js",
      mimeType: "application/javascript",
      content: `const provider = "OpenAI"; function handle(userQuestion, jobDescription) { return validate(userQuestion + jobDescription); }`
    },
    {
      path: "package-lock.json",
      mimeType: "application/json",
      content: JSON.stringify({ packages: { "node_modules/agent-base": { description: "OpenAI recruiters rate limiting" } } })
    }
  ] });
  const semanticUnits = run.packets.flatMap((packet) => packet.sourceUnits).filter((unit) => unit.evidenceKind === "SEMANTIC_INTAKE_SUMMARY");

  assert.equal(semanticUnits.length, 2);
  const summaries = semanticUnits.map((unit) => validateSemanticIntakeEvidence(JSON.parse(unit.content)));
  assert.ok(summaries.every((summary) => summary.schemaVersion === SEMANTIC_INTAKE_EVIDENCE_VERSION));
  assert.ok(summaries.some((summary) => summary.observations.some((item) => item.conceptId === "RECRUITER" && item.sourceRepresentation === "DOCUMENT_STATEMENT")));
  assert.ok(summaries.some((summary) => summary.observations.some((item) => item.conceptId === "EXTERNAL_GENERATIVE_AI" && item.sourceRepresentation === "CODE_LITERAL_OR_STRUCTURE")));
  assert.equal(semanticUnits.some((unit) => unit.sourceId === run.registeredSources.find((source) => source.path === "package-lock.json").id), false);
  assert.doesNotMatch(JSON.stringify(semanticUnits), new RegExp(privateMarker));
  assert.doesNotMatch(JSON.stringify(semanticUnits), /userQuestion|jobDescription|function handle/);
  assert.doesNotMatch(semanticUnits.map((unit) => unit.content).join("\n"), /alignment|contradiction|mismatch|finding|readiness|risk/i);
});

test("REASONER proposals can synthesize supported missing Intake wording but cannot populate Intake", async () => {
  const run = await createPreflight({ sources: [{
    path: "docs/audience.md",
    mimeType: "text/markdown",
    content: "This conversational assistant is designed for recruiters, hiring managers, and potential clients."
  }] });
  const semanticUnit = run.packets.flatMap((packet) => packet.sourceUnits).find((unit) => unit.evidenceKind === "SEMANTIC_INTAKE_SUMMARY");
  const quote = '"conceptId":"RECRUITER"';
  let transmittedPrompt = "";
  const client = new StructuredModelClient({
    policy: policy(),
    budget: new ModelBudget({ maxCalls: 2, maxTokens: 60_000 }),
    transport: async ({ profile, prompt }) => {
      transmittedPrompt = prompt;
      const start = prompt.indexOf("TARGET_FIELDS\n") + "TARGET_FIELDS\n".length;
      const targets = JSON.parse(prompt.slice(start, prompt.indexOf("\nSOURCE_PACKET", start)));
      return {
        value: { candidates: targets.map(({ field }) => field === "users" ? {
          field,
          status: "CANDIDATE",
          recommendation: "REVIEW_CANDIDATE",
          value: "Recruiters, hiring managers, potential clients",
          sourceUnitIds: [semanticUnit.id],
          evidenceQuotes: [{ sourceUnitId: semanticUnit.id, quote }],
          rationale: "The controlled audience observations support editable audience wording."
        } : {
          field,
          status: "NOT_FOUND",
          recommendation: "PROVIDE_INFORMATION",
          value: "",
          sourceUnitIds: [],
          evidenceQuotes: [],
          rationale: "No applicable controlled observation supports this field."
        }) },
        responseModel: profile.model,
        usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 }
      };
    }
  });
  const approvedPackets = run.packets.map((packet) => ({ packetId: packet.id, providers: ["MOONSHOT"] }));
  const before = structuredClone(run.solutionProfile);
  const result = await recheckDiscovery(run, { approvedPackets }, { policy: policy(), client });
  const users = result.candidates.find((candidate) => candidate.field === "users");
  const monitoringOwner = result.candidates.find((candidate) => candidate.field === "operatingBoundary.monitoringOwner");

  assert.equal(users.status, "CANDIDATE");
  assert.equal(users.recommendation, "REVIEW_CANDIDATE");
  assert.equal(monitoringOwner.status, "NOT_FOUND");
  assert.deepEqual(run.solutionProfile, before);
  assert.equal(run.approvedIntake, undefined);
  assert.match(transmittedPrompt, new RegExp(SEMANTIC_INTAKE_EVIDENCE_VERSION));
  assert.doesNotMatch(transmittedPrompt, /This conversational assistant is designed for/);
  assert.equal(run.transmissionManifest[0].containsRawEvidence, false);
});
