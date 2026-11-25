// Checks run on every inquiry before responses are drafted:
// sensitive data detection/redaction, escalation triggers and member sentiment.

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const PATTERNS = [
  {
    type: "card number",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    test: (m) => luhnValid(m.replace(/\D/g, "")),
    replacement: "[CARD NUMBER REMOVED]",
  },
  {
    type: "Social Security number",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN REMOVED]",
  },
  {
    type: "account number",
    regex: /\b(?:acct|account|member)\s*(?:#|no\.?|number)?\s*:?\s*\d{6,17}\b/gi,
    replacement: "[ACCOUNT NUMBER REMOVED]",
  },
  {
    type: "password or PIN",
    regex: /\b(?:password|passcode|pin)\s*(?:is|=|:)\s*\S+/gi,
    replacement: "[CREDENTIAL REMOVED]",
  },
];

/** Find sensitive data in the inquiry and return a redacted copy. */
export function scanSensitive(text) {
  const found = new Set();
  let redacted = String(text);
  for (const p of PATTERNS) {
    redacted = redacted.replace(p.regex, (m) => {
      if (p.test && !p.test(m)) return m;
      found.add(p.type);
      return p.replacement;
    });
  }
  return { found: [...found], redacted };
}

const ESCALATION_RULES = [
  { reason: "Possible fraud or account compromise", regex: /\b(fraud\w*|unauthori[sz]ed|stolen|hacked|scam\w*|phish\w*|identity theft|didn'?t make (this|that|these)|gave (them|him|her|someone) my|someone (called|texted))\b/i },
  { reason: "Death of a member (route to Estate Services)", regex: /\b(passed away|died|death|deceased|estate|executor)\b/i },
  { reason: "Complaint or request for a supervisor", regex: /\b(complain|complaint|supervisor|manager|unacceptable|worst|lawyer|attorney|sue|cfpb|ncua|regulator|bbb)\b/i },
  { reason: "Possible financial hardship", regex: /\b(hardship|can'?t (afford|pay)|lost my job|laid off|behind on (my )?payments?|skip a payment|bankrupt)\b/i },
  { reason: "Elder or vulnerable member concern", regex: /\b(elder abuse|my (mom|mother|dad|father|grandm\w*|grandf\w*) .*(scam|money|account)|power of attorney|poa)\b/i },
];

export function checkEscalation(text) {
  return ESCALATION_RULES.filter((r) => r.regex.test(text)).map((r) => r.reason);
}

const NEGATIVE = /\b(frustrat\w*|angry|upset|annoy\w*|ridiculous|terrible|awful|worst|unacceptable|disappoint\w*|furious|again\?|still (haven'?t|not|no)|third time|nobody|no one)\b/i;
const WORRIED = /\b(worried|scared|panic\w*|urgent|asap|emergency|help!|stolen|lost|hacked|fraud|scam)\b/i;
const GRIEF = /\b(passed away|died|death|deceased|funeral|loss of)\b/i;

/** Rough read of the member's emotional state so the opener can match it. */
export function detectSentiment(text) {
  if (GRIEF.test(text)) return "grieving";
  if (NEGATIVE.test(text) || /!{2,}/.test(text)) return "frustrated";
  if (WORRIED.test(text)) return "worried";
  return "neutral";
}
