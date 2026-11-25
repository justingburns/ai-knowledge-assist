// Knowledge base loading, placeholder rendering and search.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(file = path.join(root, "config", "credit-union.json")) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadArticles(file = path.join(root, "data", "knowledgebase.json")) {
  const articles = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const a of articles) {
    if (!a.id || !a.title || !a.summary) {
      throw new Error(`Knowledge base article is missing id, title or summary: ${JSON.stringify(a).slice(0, 80)}`);
    }
    a.keywords ??= [];
    a.steps ??= [];
  }
  return articles;
}

/** Replace {{dotted.path}} placeholders with values from the credit union config. */
export function fill(text, config) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split(".").reduce((obj, k) => (obj == null ? undefined : obj[k]), config);
    return value == null ? match : String(value);
  });
}

/** Return a copy of an article with all placeholders filled in. */
export function renderArticle(article, config) {
  return {
    ...article,
    title: fill(article.title, config),
    summary: fill(article.summary, config),
    steps: article.steps.map((s) => fill(s, config)),
    repNotes: article.repNotes ? fill(article.repNotes, config) : undefined,
    memberSummary: article.memberSummary ? fill(article.memberSummary, config) : undefined,
    memberSteps: article.memberSteps ? article.memberSteps.map((s) => fill(s, config)) : undefined,
  };
}

const STOP_WORDS = new Set(
  ("a an and are as at be but by can could do does for from get got have hi hello how i i'm im if in is it its " +
    "just me my of on or our please so that the there this to up was we what when where which who why will with " +
    "would you your yours thanks thank hey need want help").split(" "),
);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t && !STOP_WORDS.has(t))
    .map(stem);
}

// Light suffix stripping so "deposits", "deposited" and "depositing" match.
function stem(word) {
  if (word.length <= 4) return word;
  return word.replace(/(ing|ed|es|s)$/, "");
}

/**
 * BM25 search over title, summary, steps and keywords, plus a boost when a
 * multi-word keyword phrase appears verbatim in the inquiry.
 */
export function createSearchIndex(articles) {
  const docs = articles.map((a) => {
    const fields = [a.title, a.title, a.summary, a.steps.join(" "), a.keywords.join(" "), a.keywords.join(" "), a.category];
    const tokens = tokenize(fields.join(" "));
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { article: a, tf, length: tokens.length };
  });
  const avgLength = docs.reduce((s, d) => s + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  const k1 = 1.4;
  const b = 0.75;

  return function search(query, { limit = 5, minScore = 0.5 } = {}) {
    const terms = [...new Set(tokenize(query))];
    const lowerQuery = ` ${String(query).toLowerCase().replace(/\s+/g, " ")} `;
    if (terms.length === 0) return [];

    const results = docs.map((d) => {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLength)));
      }
      for (const kw of d.article.keywords) {
        if (kw.includes(" ") && lowerQuery.includes(kw.toLowerCase())) score += 2.5;
      }
      return { article: d.article, score };
    });

    return results
      .filter((r) => r.score >= minScore)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit);
  };
}
