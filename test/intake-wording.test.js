import test from "node:test";
import assert from "node:assert/strict";
import { suggestIntakeWording } from "../src/cognitive/intake-wording.js";
import { modelPolicy } from "../src/cognitive/model-policy.js";

test("wording stays advisory and filters private input and substantive changes", async () => {
  const policy = modelPolicy({ MOONSHOT_API_KEY: "test" });
  const original = "Run the check on a daily basis. Do not delete test records.";
  const input = [{ id: "purpose", text: original }, { id: "useContext", text: "Contact test@example.com" }];
  const client = { generate: async ({ prompt }) => {
    assert.match(prompt, /Run the check/);
    assert.doesNotMatch(prompt, /test@example\.com/);
    return { value: { suggestions: [
      { id: "purpose", text: "Run the check daily. Delete test records." },
      { id: "purpose", text: "Run the check daily. Do not delete test records." },
      { id: "useContext", text: "Reach the team." }
    ] } };
  } };
  assert.deepEqual(await suggestIntakeWording(input, { policy, client }), {
    status: "COMPLETED", suggestions: [{ id: "purpose", original, text: "Run the check daily. Do not delete test records." }]
  });
  assert.equal((await suggestIntakeWording(input.slice(1))).status, "NO_ELIGIBLE_TEXT");
  await assert.rejects(suggestIntakeWording([{ id: "riskStatus", text: "Unknown" }]), /Invalid Intake wording input/);
});

test("wording accepts genuine fluency improvements across narrative Intake controls while rejecting ID, number, authority or No information offered drift", async () => {
  const policy = modelPolicy({ MOONSHOT_API_KEY: "[redacted]]" });
  const originalPurpose = "System used by internal case reviewers for the drafting of summary notes across 12 regional queues under control A1.";
  const fluentPurpose = "Supports internal case reviewers by drafting summary notes across 12 regional queues under control A1.";
  const originalScope = "Only internal operators review outputs; external writes are not allowed under E-001.";
  const fluentScope = "Internal operators review all outputs, and external writes are not permitted under E-001.";
  const items = [
    { id: "purpose", text: originalPurpose },
    { id: "boundary-autonomy", text: originalScope },
    { id: "consequences", text: "No information offered" }
  ];
  const client = {
    generate: async ({ prompt }) => {
      assert.doesNotMatch(prompt, /No information offered/);
      return {
        value: {
          suggestions: [
            { id: "purpose", text: fluentPurpose },
            { id: "boundary-autonomy", text: fluentScope },
            { id: "consequences", text: "Invented consequence text" }
          ]
        }
      };
    }
  };
  const accepted = await suggestIntakeWording(items, { policy, client });
  assert.deepEqual(accepted, {
    status: "COMPLETED",
    suggestions: [
      { id: "purpose", original: originalPurpose, text: fluentPurpose },
      { id: "boundary-autonomy", original: originalScope, text: fluentScope }
    ]
  });

  const unsafeClient = {
    generate: async () => ({
      value: {
        suggestions: [
          { id: "purpose", text: "Supports internal case reviewers by drafting summary notes across 10 regional queues under control A1." },
          { id: "boundary-autonomy", text: "Internal operators review outputs and the workflow is formally approved under E-001." }
        ]
      }
    })
  };
  const rejected = await suggestIntakeWording(items.slice(0, 2), { policy, client: unsafeClient });
  assert.deepEqual(rejected.suggestions, []);
});
