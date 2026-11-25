"use strict";

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const SAMPLES = [
  "Hi, I'm setting up direct deposit with my new job. What's your routing number?",
  "I think I lost my debit card at the grocery store yesterday. What should I do??",
  "I've been charged an overdraft fee AGAIN and this is ridiculous. I want it refunded.",
  "My check deposit in the app keeps getting rejected. What am I doing wrong?",
  "Hello, my father passed away last week and I'm not sure what to do about his accounts.",
  "Someone texted me saying they were from the credit union and I gave them the code I got. Is that bad?",
  "Do you have Saturday hours?",
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderArticle(a, { match = false, open = false } = {}) {
  return el("div", { class: `article${match ? " match" : ""}` },
    el("h3", {}, a.title),
    el("div", { class: "meta" }, el("span", { class: "tag" }, a.category),
      a.escalate ? el("span", { class: "tag" }, "May need escalation") : null,
      match && a.score != null ? el("span", { class: "tag" }, `Relevance ${a.score}`) : null),
    el("p", {}, a.summary),
    el("details", open ? { open: "" } : {},
      el("summary", {}, "Details"),
      a.steps.length ? el("ol", {}, a.steps.map((s) => el("li", {}, s))) : null,
      a.repNotes ? el("p", { class: "note" }, `Rep note: ${a.repNotes}`) : null));
}

function showArticles(list, label) {
  $("kb-label").textContent = label;
  $("articles").replaceChildren(...(list.length ? list.map((a) => renderArticle(a, { match: a.score != null })) : [el("p", { class: "empty" }, "No articles found.")]));
}

let allArticles = [];
async function loadArticles(q = "") {
  const list = await api(`/api/articles${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  if (!q) allArticles = list;
  showArticles(list, q ? `Results for “${q}”` : "All articles");
}

function alertBox(kind, title, items) {
  return el("div", { class: `alert ${kind}`, role: kind === "danger" ? "alert" : "status" },
    el("strong", {}, title), items?.length ? el("ul", {}, items.map((i) => el("li", {}, i))) : null);
}

function selectOption(text) {
  $("editor").hidden = false;
  $("reply").value = text;
  $("copy-status").textContent = "";
}

function showResults(data) {
  const alerts = [];
  if (data.sensitiveFound.length) {
    alerts.push(alertBox("danger", "Sensitive information detected",
      [`The member shared: ${data.sensitiveFound.join(", ")}. It was removed before drafting. Don't repeat it in your reply.`]));
  }
  if (data.escalations.length) alerts.push(alertBox("warn", "Consider escalating", data.escalations));
  if (data.sentiment !== "neutral") alerts.push(alertBox("info", `Member seems ${data.sentiment}`, ["Responses open with an acknowledgment to match."]));
  if (data.repTip) alerts.push(alertBox("info", "Tip", [data.repTip]));
  if (data.aiError) alerts.push(alertBox("warn", "AI drafting unavailable, showing template responses", [data.aiError]));
  $("alerts").replaceChildren(...alerts);

  $("responses-empty").hidden = true;
  const titles = new Map(allArticles.map((a) => [a.id, a.title]));
  $("responses").replaceChildren(...data.options.map((o, i) => {
    const input = el("input", { type: "radio", name: "option", value: String(i), onchange: () => selectOption(o.text) });
    const sources = o.articleIds.map((id) => titles.get(id)).filter(Boolean);
    return el("label", { class: "option" }, input,
      el("div", { class: "option-head" }, el("b", {}, o.label), el("span", { class: "tag" }, o.tone),
        sources.length ? el("span", { class: "hint" }, `Source: ${sources.join("; ")}`) : null),
      el("pre", {}, o.text));
  }));
  const first = $("responses").querySelector("input");
  if (first) { first.checked = true; selectOption(data.options[0].text); }

  showArticles(data.articles, data.articles.length ? "Matched articles" : "No matching articles");
  $("kb-search").value = "";
}

async function suggest(e) {
  e?.preventDefault();
  const inquiry = $("inquiry").value.trim();
  if (!inquiry) { $("inquiry").focus(); return; }
  const btn = $("suggest-btn");
  btn.disabled = true;
  btn.textContent = "Drafting…";
  store.set("vb.repName", $("rep-name").value);
  try {
    const data = await api("/api/suggest", {
      inquiry,
      channel: document.querySelector("input[name=channel]:checked").value,
      memberName: $("member-name").value,
      repName: $("rep-name").value,
    });
    showResults(data);
  } catch (err) {
    $("alerts").replaceChildren(alertBox("danger", "Couldn't draft responses", [err.message]));
  } finally {
    btn.disabled = false;
    btn.textContent = "Suggest responses";
  }
}

async function copyReply() {
  const text = $("reply").value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $("reply").select();
    document.execCommand("copy");
  }
  $("copy-status").textContent = "Copied. Paste it into your chat or email.";
  $("copy-status").className = "hint ok";
}

async function init() {
  $("rep-name").value = store.get("vb.repName");
  $("inquiry-form").addEventListener("submit", suggest);
  $("inquiry").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) suggest(e); });
  document.querySelectorAll("input[name=channel]").forEach((r) => r.addEventListener("change", () => { // Re-draft for the new channel if responses are already showing.
    if ($("inquiry").value.trim() && $("responses-empty").hidden) suggest(); }));
  $("copy-btn").addEventListener("click", copyReply);
  let t;
  $("kb-search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => loadArticles(e.target.value.trim()), 200); });
  $("samples").replaceChildren(...SAMPLES.map((s) => el("li", {}, el("button", { type: "button", onclick: () => { $("inquiry").value = s; suggest(); } }, s))));

  try {
    const status = await api("/api/status");
    $("cu-name").textContent = `${status.creditUnion} · Member response assistant`;
    $("mode").textContent = status.ai ? "AI drafting on" : "Template mode";
    $("mode").title = status.ai ? `Responses drafted by ${status.model} from the knowledge base` : "Set ANTHROPIC_API_KEY to enable AI drafting";
  } catch { $("mode").textContent = "Offline"; }
  await loadArticles();
}

init();
