import { test } from "node:test";
import assert from "node:assert/strict";
import { loadArticles, loadConfig, fill } from "../src/kb.js";
import { scanSensitive, checkEscalation, detectSentiment } from "../src/safety.js";
import { createAssistant } from "../src/assist.js";

const config = loadConfig();
const articles = loadArticles();
const assistant = createAssistant({ articles, config, useAI: false });

const cases = [
  ["What's your routing number for direct deposit?", "routing-number"],
  ["I forgot my password and I'm locked out", "password-reset"],
  ["I lost my debit card", "lost-stolen-card"],
  ["There's a charge on my account I didn't make", "dispute-transaction"],
  ["My mobile deposit keeps getting rejected", "mobile-deposit"],
  ["How do I send a wire transfer for my house closing?", "wire-transfer"],
  ["Are you open on Saturday?", "branch-hours"],
  ["I'm going to Italy next month, do I need to tell you?", "travel-notice"],
  ["Can you waive the overdraft fee you charged me?", "fee-refund-request"],
  ["My mom passed away, what do I do with her account?", "deceased-member"],
  ["What are your auto loan rates?", "auto-loan"],
  ["I got a text from someone saying they're the credit union and gave them my verification code", "scam-impersonation"],
];

for (const [inquiry, expected] of cases) {
  test(`finds "${expected}" for: ${inquiry}`, () => {
    const [top] = assistant.search(inquiry);
    assert.equal(top?.article.id, expected);
  });
}

test("every placeholder in the knowledge base resolves", () => {
  for (const a of articles) {
    const text = fill(JSON.stringify(a), config);
    assert.doesNotMatch(text, /\{\{/, `unresolved placeholder in ${a.id}`);
  }
});

test("detects and redacts a card number but not a phone number", () => {
  const { found, redacted } = scanSensitive("My card is 4111 1111 1111 1111, call me at 555-201-3344");
  assert.deepEqual(found, ["card number"]);
  assert.match(redacted, /\[CARD NUMBER REMOVED\]/);
  assert.match(redacted, /555-201-3344/);
});

test("detects SSN and passwords", () => {
  const { found } = scanSensitive("ssn 123-45-6789 and my password is hunter2");
  assert.deepEqual(found.sort(), ["Social Security number", "password or PIN"]);
});

test("flags escalations and sentiment", () => {
  assert.ok(checkEscalation("There's a fraudulent charge, I want a supervisor").length >= 2);
  assert.equal(detectSentiment("This is ridiculous, third time asking"), "frustrated");
  assert.equal(detectSentiment("My husband passed away"), "grieving");
  assert.equal(detectSentiment("What are your hours?"), "neutral");
});

test("chat responses are friendly, personalized and grounded", async () => {
  const r = await assistant.suggest({ inquiry: "What's your routing number?", channel: "chat", memberName: "Maria" });
  assert.equal(r.source, "templates");
  assert.ok(r.options.length >= 3);
  for (const o of r.options) {
    assert.match(o.text, /^Hi Maria!/);
    assert.doesNotMatch(o.text, /Warm regards/);
  }
  assert.ok(r.options.some((o) => o.text.includes(config.routingNumber)));
});

test("email responses have a greeting and signature", async () => {
  const r = await assistant.suggest({ inquiry: "How do I reset my password?", channel: "email", memberName: "Sam", repName: "Jordan" });
  for (const o of r.options) {
    assert.match(o.text, /^Hi Sam,/);
    assert.match(o.text, /Warm regards,\nJordan\n/);
  }
});

test("sensitive data triggers a security reminder and is never echoed", async () => {
  const r = await assistant.suggest({ inquiry: "I lost my card 4111111111111111 help!", channel: "chat" });
  assert.deepEqual(r.sensitiveFound, ["card number"]);
  for (const o of r.options) {
    assert.doesNotMatch(o.text, /4111/);
    assert.match(o.text, /don't share full card numbers/);
  }
});

test("frustrated members get an empathetic opener and escalation flag", async () => {
  const r = await assistant.suggest({ inquiry: "I'm so frustrated, you charged me an overdraft fee again. Refund it!", channel: "chat" });
  assert.equal(r.sentiment, "frustrated");
  assert.match(r.options[0].text, /sorry for the frustration/);
  assert.ok(r.escalations.length > 0);
});

test("unknown questions get safe fallback options", async () => {
  const r = await assistant.suggest({ inquiry: "Do you sell cryptocurrency?", channel: "chat" });
  assert.equal(r.articles.length, 0);
  assert.equal(r.options.length, 3);
});

test("rejects empty inquiries and bad channels", async () => {
  await assert.rejects(assistant.suggest({ inquiry: "  " }));
  await assert.rejects(assistant.suggest({ inquiry: "hi", channel: "fax" }));
});
