# CLAUDE.md — NodesJS Mail Triage

## Project Overview

**nodesjs-mail-triage** is a German municipality citizen-inquiry management system. It classifies incoming citizen emails into routing groups (e.g., Bürgerbüro, Ordnungsamt, Standesamt) and generates a polite first-response draft. Classification can be rule-based (keyword scoring) or AI-driven (OpenAI GPT).

**Language note:** The domain, UI labels, prompt templates, default data, and error messages are all in German. Keep them in German. Code identifiers and comments should be in English.

---

## Repository Layout

```
NodesJS/
├── src/
│   └── server.js          # Entire backend: HTTP server + all business logic
├── public/
│   ├── index.html         # Single-page UI
│   ├── app.js             # Vanilla JS frontend logic
│   └── styles.css         # Minimal card-based styling
├── data/
│   └── feedback-db.json   # Persistent JSON "database" (auto-created on first run)
├── package.json
└── README.md              # German documentation
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES modules, `"type": "module"`) |
| Server | `node:http` — no framework |
| Frontend | Vanilla HTML / CSS / JS — no frameworks or bundler |
| Persistence | Single JSON file (`data/feedback-db.json`) |
| External AI | OpenAI Chat Completions API (optional) |
| Dependencies | **None** — only Node.js built-ins |

---

## Running the Project

```bash
# Production
npm start

# Development (auto-reload on file change)
npm run dev
```

The server starts on port `3000` by default (override with `PORT` env var). Open `http://localhost:3000` to use the UI.

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | No | — | Enables OpenAI routing/reply mode |
| `PORT` | No | `3000` | HTTP listen port |

Without `OPENAI_API_KEY`, the app silently falls back to rule-based mode for all requests — no crash.

---

## Architecture

### Request Flow

```
Browser UI
  └─► POST /api/analyze { emailText, provider }
        ├─ provider === 'openai'
        │    ├─ classifyGroupWithOpenAI()   → OpenAI /chat/completions (json_object)
        │    └─ generateOpenAIReply()       → OpenAI /chat/completions
        └─ provider === 'rule-based' (or OpenAI fallback)
             ├─ detectGroupKeywordBased()
             └─ generateRuleBasedReply()
        └─ Persisted to feedback-db.json as an analysis record
```

### Data Model (`feedback-db.json`)

```jsonc
{
  "analyses": [         // Every /api/analyze call appended here
    {
      "id": 1,
      "emailText": "...",
      "predictedGroup": "Standesamt",
      "generatedResponse": "...",
      "llmProvider": "openai | rule-based | rule-based-fallback",
      "modelNotice": "gpt-4o-mini",
      "classificationReason": "...",
      "matchedKnowledgeDocumentIds": [1],
      "createdAt": "ISO8601"
    }
  ],
  "feedback": [         // User corrections/ratings via /api/feedback
    {
      "id": 1,
      "analysisId": 1,
      "rating": "good | bad | null",
      "correctionGroup": "...",
      "correctionResponse": "...",
      "note": "...",
      "createdAt": "ISO8601"
    }
  ],
  "routingGroups": [    // Managed via /api/routing-groups
    { "id": 1, "name": "Bürgerbüro", "keywords": ["termin", ...] }
  ],
  "knowledgeDocuments": [ // Managed via /api/documents
    { "id": 1, "title": "...", "tags": ["öffnungszeiten"], "content": "..." }
  ],
  "aiConfig": {         // Updated via PUT /api/ai-config
    "openaiModel": "gpt-4o-mini",
    "temperature": 0.2,
    "maxTokens": 450,
    "systemPrompt": "...",
    "routingPromptTemplate": "...",  // uses {{groups}}, {{emailText}}
    "replyPromptTemplate": "...",    // uses {{group}}, {{emailText}}, {{knowledgeContext}}, {{historyContext}}
    "contextModeEnabled": false,
    "contextItems": 5
  },
  "counters": { "analysis": 1, "feedback": 1, "group": 7, "document": 2 }
}
```

**Schema migration:** `ensureDb()` runs at startup and merges any existing JSON with `defaultDb` defaults, so adding new fields to `defaultDb` is the correct way to introduce schema changes.

---

## API Endpoints

| Method | Path | Body / Notes |
|---|---|---|
| `GET` | `/api/config` | Returns `{ routingGroups, aiConfig, knowledgeDocuments }` |
| `GET` | `/api/documents` | Returns `{ documents: [...] }` |
| `POST` | `/api/documents` | `{ title, content, tags? }` — creates a knowledge document |
| `POST` | `/api/routing-groups` | `{ name, keywords? }` — adds a routing group |
| `PUT` | `/api/ai-config` | Partial update of `aiConfig` fields |
| `POST` | `/api/analyze` | `{ emailText, provider }` where `provider` is `"openai"` or `"rule-based"` |
| `POST` | `/api/feedback` | `{ analysisId, rating?, correctionGroup?, correctionResponse?, note? }` |
| `GET` | `/` | Serves `public/index.html` |
| `GET` | `/*.js` `/*.css` | Serves from `public/` (path-traversal protected) |

---

## Key Functions (`src/server.js`)

| Function | Purpose |
|---|---|
| `ensureDb()` | Creates/migrates `feedback-db.json` on startup |
| `readDb()` / `writeDb()` | Thin wrappers: parse/stringify JSON file |
| `detectGroupKeywordBased(text, groups)` | Scores each group's keywords against inquiry; returns best group name |
| `interpolate(template, values)` | Replaces `{{key}}` placeholders in prompt templates |
| `getRelevantKnowledge(text, docs)` | Tag-based scoring; returns top-3 matching knowledge documents |
| `buildHistoryContext(db, limit)` | Formats last N analyses + feedback into a prompt context string |
| `classifyGroupWithOpenAI(...)` | Calls OpenAI with `response_format: json_object`; falls back to keyword-based if JSON is invalid |
| `generateRuleBasedReply(...)` | Template letter with inquiry preview and optional knowledge hints |
| `generateOpenAIReply(...)` | Calls OpenAI with configurable model/temperature/tokens |
| `sendJson(res, status, payload)` | Writes JSON response with correct Content-Type |
| `readRequestBody(req)` | Collects chunks from the request stream and parses JSON |

---

## Coding Conventions

- **ES modules only.** Use `import`/`export`; no `require()`.
- **`__dirname` shim.** Because this is an ES module, use the pattern at the top of `server.js`:
  ```js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  ```
- **No dependencies.** Do not add npm packages unless absolutely necessary. Prefer Node.js built-ins.
- **Single-file backend.** All server logic lives in `src/server.js`. Do not split into multiple modules without a clear reason.
- **Async/await throughout.** All async operations use `async/await`; no raw Promises or callbacks.
- **Counter-based IDs.** New records get `db.counters.<collection>++` as their `id`. Always increment before writing.
- **Prompt templates use `{{variable}}` syntax** (double curly braces). The `interpolate()` function handles substitution.
- **German strings.** Error messages sent to the client, default prompt templates, and routing group names are in German.
- **Path traversal protection.** Static files are blocked if `filePath` doesn't start with `publicDir`.

---

## OpenAI Integration Details

- **Routing call:** `temperature: 0` (deterministic), `response_format: { type: 'json_object' }`. Expected response: `{"group":"...", "reason":"..."}`.
- **Reply call:** Uses `aiConfig.temperature` and `aiConfig.maxTokens` from the DB.
- **Fallback:** If `classifyGroupWithOpenAI` throws (no API key, network error, bad JSON), `generateRuleBasedReply` is used and `providerUsed` is set to `"rule-based-fallback"`.
- **History context:** Optionally prepends the last N analyses + feedback into the prompt when `aiConfig.contextModeEnabled` is `true`. This lets the model learn from human corrections.
- **Knowledge context:** Top-3 documents by tag-match score are injected into the reply prompt.

---

## No Tests / No Build Step

There are currently **no automated tests** and **no build process**. The server runs directly from source. When adding tests, use Node.js's built-in `node:test` runner to stay dependency-free.

---

## Git Workflow

- Active development branch: `claude/claude-md-docs-ez4GH`
- Push with: `git push -u origin <branch-name>`
- Do **not** push to `main` without explicit permission.

---

## Common Tasks

### Add a new routing group permanently (default data)
Edit `defaultDb.routingGroups` in `src/server.js` and bump the initial `counters.group` value.

### Add a new API endpoint
Add a new `if (req.method === '...' && req.url === '...')` block inside the `http.createServer` callback, before the static-file fallback block.

### Change AI model or prompt defaults
Edit `defaultDb.aiConfig` in `src/server.js`. Existing databases will receive the new defaults on next startup (via `ensureDb` merge).

### Add a new DB field
1. Add it to `defaultDb` with its default value.
2. The `ensureDb` migration will spread it into existing databases automatically.
3. Read/write it through `readDb()`/`writeDb()` as usual.
