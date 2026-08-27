import test from "node:test";
import assert from "node:assert/strict";
import { extractStructuredHtml } from "../src/intake/html-evidence.js";
import { parseAndScreenSources } from "../src/cognitive/source-intake.js";

test("HTML extraction is inert and preserves semantic structure with stable local locators", () => {
  const html = `<!doctype html><html><head><title>Evidence & Context</title><style>.hidden{display:none}</style></head><body>
    <main><section><h1>System boundary</h1><p>Visible <strong>purpose</strong> text.</p>
    <ul><li>First item</li><li>Second item</li></ul>
    <table><caption>Owners</caption><tr><th>Role</th><th>Team</th></tr><tr><td>Reviewer</td><td>Synthetic Team</td></tr></table></section></main>
    <script type="application/json">{"record":{"name":"Synthetic Record","enabled":true}}</script>
    <script>throw new Error("MUST_NOT_EXECUTE")</script><img src="x" onerror="MUST_NOT_EXECUTE()">
  </body></html>`;
  const result = extractStructuredHtml(html);
  const byLocator = new Map(result.segments.map((segment) => [segment.locator, segment.text]));

  assert.equal(byLocator.get("html:title"), "Evidence & Context");
  assert.ok(result.segments.some((segment) => /heading:1:h1$/.test(segment.locator) && segment.text === "System boundary"));
  assert.ok(result.segments.some((segment) => /paragraph:1$/.test(segment.locator) && segment.text === "Visible purpose text."));
  assert.deepEqual(result.segments.filter((segment) => /list-item/.test(segment.locator)).map((segment) => segment.text), ["First item", "Second item"]);
  assert.deepEqual(result.segments.filter((segment) => /table:1;row/.test(segment.locator)).map((segment) => segment.text), ["Role | Team", "Reviewer | Synthetic Team"]);
  assert.match(byLocator.get("html:embedded-json:1"), /"Synthetic Record"/);
  assert.doesNotMatch(result.segments.map((segment) => segment.text).join("\n"), /MUST_NOT_EXECUTE|display:none/);
  assert.deepEqual(result.limitationCodes, ["UNSUPPORTED_EMBEDDED_SCRIPT_CONTENT_SKIPPED"]);
});

test("supported embedded JSON is inspected locally, screened, and excluded from provider summaries", async () => {
  const privateMarker = "synthetic.person@example.com";
  const screened = await parseAndScreenSources([{
    path: "synthetic-report.html",
    mimeType: "text/html",
    format: "HTML",
    encoding: "utf8",
    content: `<h1>Structured report</h1><script type="application/ld+json">{"contact":"${privateMarker}","status":"review"}</script>`,
    metadata: {}
  }]);

  const local = screened.localSourceUnits.map((unit) => unit.content).join("\n");
  const provider = screened.sourceUnits.map((unit) => unit.content).join("\n");
  assert.match(local, /REDACTED_EMAIL/);
  assert.doesNotMatch(local, new RegExp(privateMarker.replace(".", "\\.")));
  assert.ok(screened.dlpFindings.some((finding) => finding.type === "EMAIL"));
  assert.doesNotMatch(provider, /synthetic\.person|contact|review/i);
  assert.equal(screened.registeredSources[0].extractionDiagnostics.limitationCodes.length, 0);
  assert.ok(screened.localSourceUnits.some((unit) => unit.locator.startsWith("html:embedded-json:")));
});

test("invalid or excessive embedded JSON fails visibly without executing or aborting visible HTML extraction", () => {
  const deep = `${'{"child":'.repeat(30)}{}${"}".repeat(30)}`;
  const result = extractStructuredHtml(`<h1>Visible heading</h1><script type="application/json">{invalid}</script><script type="application/json">${deep}</script>`);
  assert.equal(result.segments[0].text, "Visible heading");
  assert.ok(result.limitationCodes.includes("EMBEDDED_JSON_PARSE_FAILED"));
  assert.ok(result.limitationCodes.includes("EMBEDDED_JSON_LIMIT_EXCEEDED"));
});

test("HTML definition lists become labelled pairs and leftover terms are not emitted as values", () => {
  const result = extractStructuredHtml(`<!doctype html><html><body>
    <section>
      <dl>
        <dt>Owner</dt><dd>Oversight Board</dd>
        <dt>Intended purpose</dt><dd>Support bounded internal reviews</dd>
        <dt>Orphan term</dt>
      </dl>
      <p>Visible after definitions.</p>
    </section>
  </body></html>`);
  const definitions = result.segments.filter((segment) => /;definition:\d+$/.test(segment.locator));
  assert.deepEqual(definitions.map((segment) => segment.text), [
    "Owner: Oversight Board",
    "Intended purpose: Support bounded internal reviews"
  ]);
  assert.ok(result.segments.some((segment) => /paragraph:1$/.test(segment.locator) && segment.text === "Visible after definitions."));
  assert.equal(result.segments.some((segment) => segment.text === "Orphan term" || /;block:\d+:dt$/.test(segment.locator)), false);
  assert.match(definitions[0].locator, /^html:section:\d+;definition:1$/);
});

test("unpaired definition values remain visible without inventing a label", () => {
  const result = extractStructuredHtml("<dl><dd>Standalone definition value</dd></dl>");
  assert.equal(result.segments.some((segment) => /;definition:/.test(segment.locator)), false);
  assert.ok(result.segments.some((segment) => /;block:\d+:dd$/.test(segment.locator) && segment.text === "Standalone definition value"));
});
