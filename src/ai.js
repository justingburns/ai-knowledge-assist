// Claude-powered response drafting, grounded in the matched knowledge base articles.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const ResponseSet = z.object({
  options: z
    .array(
      z.object({
        label: z.string().describe("2-4 word name for the option, e.g. 'Quick answer'"),
        tone: z.string().describe("One word: Concise, Instructional, Empathetic, Clarify, Holding or Referral"),
        text: z.string().describe("The complete reply, ready to send to the member"),
        articleIds: z.array(z.string()).describe("IDs of the knowledge base articles this reply relies on"),
      }),
    )
    .describe("Three or four distinct reply options"),
  repTip: z.string().describe("One short internal tip for the rep (never sent to the member); empty string if none"),
});

let client;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function systemPrompt(config) {
  return `You draft replies for contact center representatives at ${config.name}, a member-owned credit union. The rep reads your drafts, picks one from a list, may edit it, and sends it to the member over online chat or email.

How to write:
- Friendly, warm and professional. Plain language at about an 8th-grade reading level. Call customers "members", never "customers".
- Use only facts from the knowledge base articles and credit union details provided. Never invent rates, fees, limits, timeframes, phone numbers or policies. If the articles don't cover the question, offer a clarifying question, a research-and-follow-up reply, or a referral to ${config.phone}.
- Never ask the member to send a full card number, account number, Social Security number, password, PIN or verification code over chat or email. If the inquiry contains a redaction marker like [CARD NUMBER REMOVED], include a brief, kind reminder not to share that information this way.
- Never promise outcomes that need approval (fee refunds, dispute results, loan decisions). Say what will happen next and when.
- Match the member's emotional state: acknowledge frustration or worry briefly and sincerely, and lead with condolences if a death is mentioned. Don't over-apologize.
- Chat replies: 1-4 short paragraphs, start with "Hi <first name>!" (or "Hi there!" without a name), no email sign-off. End with a short offer to help further when it fits.
- Email replies: start "Hi <first name>," (or "Hello,"), use full sentences and short paragraphs, and end with "${config.responseDefaults?.emailClosing ?? "Warm regards,"}", then the rep's name on its own line if given, then "${config.shortName} ${config.responseDefaults?.teamSignature ?? "Member Services"}".
- Numbered steps are good when the member needs to do something.

Write three or four options that differ in a useful way, typically: a concise answer, a step-by-step answer, and a warmer, more thorough answer. Add a clarifying-question option when the inquiry is ambiguous.

Credit union details:
${JSON.stringify(config, null, 2)}`;
}

function articleBlock(articles) {
  return articles
    .map(
      (a) =>
        `<article id="${a.id}" category="${a.category}"${a.escalate ? ' escalate="true"' : ""}>
<title>${a.title}</title>
<summary>${a.memberSummary ?? a.summary}</summary>
${(a.memberSteps ?? a.steps).length ? `<steps>\n${(a.memberSteps ?? a.steps).map((s, i) => `${i + 1}. ${s}`).join("\n")}\n</steps>` : ""}
${a.repNotes ? `<rep_notes>${a.repNotes}</rep_notes>` : ""}
</article>`,
    )
    .join("\n\n");
}

/**
 * Ask Claude for reply options. The inquiry passed in is already redacted,
 * so card numbers, SSNs and credentials never leave the server.
 */
export async function draftWithClaude({ inquiry, channel, memberName, repName, sentiment, escalations, articles, config }) {
  client ??= new Anthropic();
  const user = `<knowledge_base>
${articles.length ? articleBlock(articles) : "(No matching articles were found.)"}
</knowledge_base>

<context>
Channel: ${channel}
Member first name: ${memberName || "(unknown)"}
Rep name: ${repName || "(not given)"}
Detected sentiment: ${sentiment}
Escalation flags: ${escalations.length ? escalations.join("; ") : "none"}
</context>

<member_inquiry>
${inquiry}
</member_inquiry>

Draft the reply options now.`;

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ResponseSet) },
    system: systemPrompt(config),
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to draft a reply for this inquiry.");
  }
  if (!response.parsed_output) {
    throw new Error(`Claude returned no usable reply options (stop reason: ${response.stop_reason}).`);
  }
  const known = new Set(articles.map((a) => a.id));
  return {
    options: response.parsed_output.options.map((o) => ({
      ...o,
      articleIds: o.articleIds.filter((id) => known.has(id)),
    })),
    repTip: response.parsed_output.repTip,
    model: response.model,
  };
}
