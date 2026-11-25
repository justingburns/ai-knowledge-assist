// Virtual Branch: a small HTTP server with no framework dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArticles, loadConfig } from "./src/kb.js";
import { createAssistant } from "./src/assist.js";
import { aiEnabled, MODEL } from "./src/ai.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;

const config = loadConfig();
const assistant = createAssistant({ articles: loadArticles(), config });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error("Request is too large.");
  }
  return JSON.parse(data || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, { creditUnion: config.name, ai: aiEnabled(), model: aiEnabled() ? MODEL : null, articles: assistant.articles.length });
    }
    if (req.method === "GET" && url.pathname === "/api/articles") {
      const q = url.searchParams.get("q");
      const list = q ? assistant.search(q, { limit: 10, minScore: 0.1 }).map((m) => m.article) : assistant.articles;
      return send(res, 200, list);
    }
    if (req.method === "POST" && url.pathname === "/api/suggest") {
      const body = await readJson(req);
      return send(res, 200, await assistant.suggest(body));
    }
    if (req.method === "GET") {
      const file = path.normalize(path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname));
      if (file.startsWith(publicDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream");
      }
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Virtual Branch is running at http://localhost:${PORT}`);
  console.log(aiEnabled() ? `Drafting with Claude (${MODEL}).` : "No ANTHROPIC_API_KEY set: using built-in response templates.");
});
