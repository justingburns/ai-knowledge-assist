// Core pipeline: safety checks -> knowledge base search -> response options.
import { createSearchIndex, renderArticle } from "./kb.js";
import { scanSensitive, checkEscalation, detectSentiment } from "./safety.js";
import { composeResponses } from "./templates.js";
import { aiEnabled, draftWithClaude } from "./ai.js";

export function createAssistant({ articles, config, useAI = aiEnabled() }) {
  const rendered = articles.map((a) => renderArticle(a, config));
  const search = createSearchIndex(rendered);

  async function suggest({ inquiry, channel = "chat", memberName = "", repName = "" }) {
    if (!inquiry || !String(inquiry).trim()) throw new Error("Please paste or type the member's inquiry.");
    if (!["chat", "email"].includes(channel)) throw new Error('Channel must be "chat" or "email".');

    const { found: sensitiveFound, redacted } = scanSensitive(inquiry);
    const sentiment = detectSentiment(inquiry);
    const matches = search(redacted, { limit: 4 });
    const escalations = [...new Set([
      ...checkEscalation(inquiry),
      ...matches.slice(0, 1).filter((m) => m.article.escalate).map((m) => `Policy: “${m.article.title}” may need escalation`),
    ])];

    const ctx = { config, memberName, repName, sentiment, sensitiveFound };
    let options;
    let source = "templates";
    let repTip = "";
    let aiError;

    if (useAI) {
      try {
        const ai = await draftWithClaude({
          inquiry: redacted, channel, memberName, repName, sentiment, escalations,
          articles: matches.map((m) => m.article), config,
        });
        options = ai.options;
        repTip = ai.repTip;
        source = ai.model;
      } catch (err) {
        aiError = err.message;
      }
    }
    options ??= composeResponses({ matches, channel, ctx });

    return {
      options,
      source,
      aiError,
      repTip,
      sentiment,
      sensitiveFound,
      escalations,
      redactedInquiry: redacted,
      articles: matches.map((m) => ({ ...m.article, score: Number(m.score.toFixed(2)) })),
    };
  }

  return { suggest, search: (q, opts) => search(q, opts), articles: rendered };
}
