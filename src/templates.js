// Offline response composer. Builds friendly, professional replies straight
// from knowledge base articles, so the tool works with no API key at all.

/** Turn rep-facing summary wording ("Members can…") into member-facing wording. */
export function toMemberVoice(text) {
  return text
    .replace(/\bMembers can\b/g, "You can")
    .replace(/\bmembers can\b/g, "you can")
    .replace(/\bMembers should\b/g, "You should")
    .replace(/\bThe member's\b/g, "Your")
    .replace(/\bthe member's\b/g, "your")
    .replace(/\bthe member\b/g, "you")
    .replace(/\bMembers\b/g, "You")
    .replace(/\bmembers\b/g, "you");
}

const OPENERS = {
  chat: {
    neutral: "Thanks for reaching out!",
    frustrated: "I'm really sorry for the frustration, and I'm glad to help get this sorted out.",
    worried: "I understand this is stressful. Let's get it taken care of right away.",
    grieving: "I'm so sorry for your loss. Please accept our heartfelt condolences.",
  },
  email: {
    neutral: "Thank you for contacting {cu}. I'm happy to help.",
    frustrated: "Thank you for contacting {cu}, and I'm sorry for the frustration this has caused. I'd like to help make it right.",
    worried: "Thank you for contacting {cu}. I understand this is stressful, and I want to help you resolve it as quickly as possible.",
    grieving: "I'm so sorry for your loss. On behalf of everyone at {cu}, please accept our heartfelt condolences.",
  },
};

const SECURITY_REMINDER =
  "For your security, please don't share full card numbers, Social Security numbers, passwords or verification codes over chat or email. We'll never ask for them this way.";

function greeting(channel, memberName) {
  const name = memberName?.trim();
  if (channel === "email") return name ? `Hi ${name},` : "Hello,";
  return name ? `Hi ${name}!` : "Hi there!";
}

function numbered(steps) {
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function wrap({ body, channel, ctx, opener = true, closingLine }) {
  const { config, memberName, repName, sentiment, sensitiveFound } = ctx;
  const cu = config.shortName ?? config.name;
  const parts = [];
  const open = opener ? OPENERS[channel][sentiment].replace("{cu}", cu) : "";

  if (channel === "chat") {
    parts.push(`${greeting("chat", memberName)} ${open}`.trim());
    if (sensitiveFound.length) parts.push(SECURITY_REMINDER);
    parts.push(body);
    parts.push(closingLine ?? "Is there anything else I can help you with today?");
    return parts.join("\n\n");
  }

  parts.push(greeting("email", memberName));
  if (open) parts.push(open);
  if (sensitiveFound.length) parts.push(SECURITY_REMINDER);
  parts.push(body);
  parts.push(
    closingLine ??
      `If you have any other questions, just reply to this email or call us at ${config.phone}, ${config.hours.contactCenter}.`,
  );
  const closing = config.responseDefaults?.emailClosing ?? "Warm regards,";
  const team = `${cu} ${config.responseDefaults?.teamSignature ?? "Member Services"}`;
  parts.push([closing, repName?.trim(), team].filter(Boolean).join("\n"));
  return parts.join("\n\n");
}

/**
 * Compose three response options for the best-matching article, plus a
 * clarifying-question option when the top matches are close.
 */
export function composeResponses({ matches, channel, ctx }) {
  if (matches.length === 0) return fallbackResponses({ channel, ctx });

  const top = matches[0].article;
  const summary = top.memberSummary ?? toMemberVoice(top.summary);
  const steps = top.memberSteps ?? top.steps;
  const options = [];

  options.push({
    label: "Quick answer",
    tone: "Concise",
    articleIds: [top.id],
    text: wrap({ body: summary, channel, ctx }),
  });

  if (steps.length) {
    options.push({
      label: "Step-by-step",
      tone: "Instructional",
      articleIds: [top.id],
      text: wrap({ body: `${summary}\n\nHere's how:\n${numbered(steps)}`, channel, ctx }),
    });
  }

  const warmClose =
    channel === "chat"
      ? "I'm happy to stay on while you give it a try. Just let me know how it goes!"
      : `I hope this helps! If anything doesn't go as expected, reply here or call us at ${ctx.config.phone} and we'll walk through it with you.`;
  const extra = matches[1] && matches[1].score > matches[0].score * 0.6 ? matches[1].article : null;
  const extraLine = extra
    ? `\n\nYou might also find this helpful: ${toMemberVoice(extra.memberSummary ?? extra.summary)}`
    : "";
  options.push({
    label: "Warm & thorough",
    tone: "Empathetic",
    articleIds: extra ? [top.id, extra.id] : [top.id],
    text: wrap({
      body: `${summary}${steps.length ? `\n\n${numbered(steps)}` : ""}${extraLine}`,
      channel,
      ctx,
      closingLine: warmClose,
    }),
  });

  const close = matches.slice(1, 3).filter((m) => m.score > matches[0].score * 0.8);
  if (close.length) {
    const topics = [top, ...close.map((m) => m.article)].map((a) => a.title.toLowerCase());
    options.push({
      label: "Clarifying question",
      tone: "Clarify",
      articleIds: [top.id, ...close.map((m) => m.article.id)],
      text: wrap({
        body: `I want to make sure I point you in the right direction. Is your question about ${listOr(topics)}?`,
        channel,
        ctx,
        closingLine: channel === "chat" ? "" : undefined,
      }).trim(),
    });
  }
  return options;
}

function listOr(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function fallbackResponses({ channel, ctx }) {
  const { config } = ctx;
  return [
    {
      label: "Ask for details",
      tone: "Clarify",
      articleIds: [],
      text: wrap({
        body: "I'd be glad to help with this. Could you tell me a little more about what you need so I can get you the right information?",
        channel,
        ctx,
        closingLine: channel === "chat" ? "" : undefined,
      }).trim(),
    },
    {
      label: "Research & follow up",
      tone: "Holding",
      articleIds: [],
      text: wrap({
        body:
          channel === "chat"
            ? "That's a great question. Let me check with the right team so I can give you an accurate answer. It should only take a moment."
            : "I want to make sure you get an accurate answer, so I'm checking with the right team. I'll follow up with you within one business day.",
        channel,
        ctx,
      }),
    },
    {
      label: "Refer by phone",
      tone: "Referral",
      articleIds: [],
      text: wrap({
        body: `This is best handled by one of our specialists, who can verify your identity and review your account securely. Please call us at ${config.phone}, ${config.hours.contactCenter}.`,
        channel,
        ctx,
      }),
    },
  ];
}
