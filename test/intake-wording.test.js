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
