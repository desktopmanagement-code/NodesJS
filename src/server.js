import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, '..', 'public');
const dbFilePath = path.join(__dirname, '..', 'data', 'feedback-db.json');

const defaultDb = {
  analyses: [],
  feedback: [],
  routingGroups: [
    { id: 1, name: 'Bürgerbüro', keywords: ['öffnungszeiten', 'geöffnet', 'oeffnungszeiten', 'termin', 'personalausweis', 'reisepass', 'meldebescheinigung', 'bürgerbüro', 'buergerbuero'] },
    { id: 2, name: 'Ordnungsamt', keywords: ['lärm', 'parken', 'ordnungswidrigkeit', 'hund', 'genehmigung'] },
    { id: 3, name: 'Bauamt', keywords: ['bauantrag', 'baustelle', 'garage', 'grundstück', 'bebauungsplan'] },
    { id: 4, name: 'Jugend', keywords: ['jugend', 'kind', 'ferienprogramm', 'kita', 'betreuung'] },
    { id: 5, name: 'Gebührenstelle', keywords: ['gebühr', 'kosten', 'rechnung', 'zahlung', 'bescheid'] },
    { id: 6, name: 'Standesamt', keywords: ['heirat', 'ehe', 'eheurkunde', 'geburt', 'geburtsurkunde'] }
  ],
  knowledgeDocuments: [
    {
      id: 1,
      title: 'Öffnungszeiten Bürgerbüro',
      tags: ['öffnungszeiten', 'bürgerbüro'],
      content: 'Bürgerbüro: Montag bis Freitag 08:00-12:00, Dienstag zusätzlich 14:00-16:00, Donnerstag zusätzlich 14:00-18:00.'
    }
  ],
  aiConfig: {
    openaiModel: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 450,
    systemPrompt: 'Du bist Assistenz einer deutschen Gemeindeverwaltung. Ordne Bürgeranfragen der passenden Stelle zu und verfasse eine höfliche, klare Erstantwort.',
    routingPromptTemplate: 'Wähle genau eine Zielgruppe aus der Liste: {{groups}}. Entscheide semantisch (z.B. Ehelichung => Standesamt), nicht nur über exakte Keywords. Anfrage:\n{{emailText}}',
    replyPromptTemplate: 'Du beantwortest eine Anfrage für die Gruppe {{group}}. Nutze bekannte Informationen aus den Dokumenten (wenn passend) und nenne sonst die nächsten Schritte. Anfrage:\n{{emailText}}\n\nKontextdokumente:\n{{knowledgeContext}}'
  },
  counters: { analysis: 1, feedback: 1, group: 7, document: 2 }
};

async function ensureDb() {
  await fs.mkdir(path.dirname(dbFilePath), { recursive: true });
  try {
    await fs.access(dbFilePath);
    const parsed = JSON.parse(await fs.readFile(dbFilePath, 'utf-8'));
    const migrated = {
      analyses: parsed.analyses || [],
      feedback: parsed.feedback || [],
      routingGroups: parsed.routingGroups || defaultDb.routingGroups,
      knowledgeDocuments: parsed.knowledgeDocuments || defaultDb.knowledgeDocuments,
      aiConfig: { ...defaultDb.aiConfig, ...(parsed.aiConfig || {}) },
      counters: { ...defaultDb.counters, ...(parsed.counters || {}) }
    };
    await fs.writeFile(dbFilePath, JSON.stringify(migrated, null, 2), 'utf-8');
  } catch {
    await fs.writeFile(dbFilePath, JSON.stringify(defaultDb, null, 2), 'utf-8');
  }
}

async function readDb() {
  return JSON.parse(await fs.readFile(dbFilePath, 'utf-8'));
}

async function writeDb(db) {
  await fs.writeFile(dbFilePath, JSON.stringify(db, null, 2), 'utf-8');
}

function detectGroupKeywordBased(emailText, routingGroups) {
  const text = emailText.toLowerCase();
  let best = { name: 'Allgemeiner Bürgerservice', score: 0 };

  for (const group of routingGroups) {
    const score = group.keywords.reduce((acc, keyword) => (text.includes(keyword.toLowerCase()) ? acc + 1 : acc), 0);
    if (score > best.score) best = { name: group.name, score };
  }

  return best.name;
}

function interpolate(template, values) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => values[key] ?? '');
}

function getRelevantKnowledge(emailText, documents) {
  const text = emailText.toLowerCase();
  const scored = documents.map((doc) => {
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    const score = tags.reduce((acc, tag) => (text.includes(String(tag).toLowerCase()) ? acc + 1 : acc), 0);
    return { doc, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.doc);
}

function openAIHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

async function classifyGroupWithOpenAI(emailText, routingGroups, aiConfig) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY fehlt.');

  const groupNames = routingGroups.map((group) => group.name);
  const userPrompt = interpolate(aiConfig.routingPromptTemplate, {
    emailText,
    groups: groupNames.join(', ')
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: openAIHeaders(apiKey),
    body: JSON.stringify({
      model: aiConfig.openaiModel,
      temperature: 0,
      messages: [
        { role: 'system', content: aiConfig.systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nGib nur JSON zurück: {"group":"...","reason":"..."}` }
      ],
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) throw new Error(`OpenAI Klassifikation fehlgeschlagen: ${response.status}`);
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || '{}';
  const parsed = JSON.parse(raw);

  const selected = groupNames.includes(parsed.group) ? parsed.group : detectGroupKeywordBased(emailText, routingGroups);
  return {
    group: selected,
    reason: parsed.reason || 'KI-Klassifikation ohne Begründung'
  };
}

function generateRuleBasedReply(emailText, group, knowledgeDocuments = []) {
  const preview = emailText.slice(0, 220).replace(/\s+/g, ' ').trim();
  const docsHint = knowledgeDocuments.length > 0
    ? `\n\nHinweis aus hinterlegten Dokumenten:\n${knowledgeDocuments.map((doc) => `- ${doc.title}: ${doc.content}`).join('\n')}`
    : '';

  return `Guten Tag,\n\nvielen Dank für Ihre Nachricht an die Gemeinde. Ihr Anliegen wurde der Gruppe "${group}" zugeordnet und wird dort geprüft.\n\nFalls Unterlagen oder Angaben fehlen, melden wir uns kurzfristig bei Ihnen.\n\nIhre Anfrage (Kurzfassung): "${preview}${emailText.length > 220 ? '…' : ''}"${docsHint}\n\nFreundliche Grüße\nGemeindeverwaltung`;
}

async function generateOpenAIReply(emailText, group, aiConfig, relevantKnowledge) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY fehlt.');

  const knowledgeContext = relevantKnowledge.length > 0
    ? relevantKnowledge.map((doc) => `Titel: ${doc.title}\nTags: ${(doc.tags || []).join(', ')}\nInhalt: ${doc.content}`).join('\n\n')
    : 'Keine passenden Dokumente vorhanden.';

  const userPrompt = interpolate(aiConfig.replyPromptTemplate, {
    emailText,
    group,
    knowledgeContext
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: openAIHeaders(apiKey),
    body: JSON.stringify({
      model: aiConfig.openaiModel,
      temperature: Number(aiConfig.temperature),
      max_tokens: Number(aiConfig.maxTokens),
      messages: [
        { role: 'system', content: aiConfig.systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI Antwort fehlgeschlagen: ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: 'Ungültige Anfrage.' });

    if (req.method === 'GET' && req.url === '/api/config') {
      const db = await readDb();
      return sendJson(res, 200, {
        routingGroups: db.routingGroups,
        aiConfig: db.aiConfig,
        knowledgeDocuments: db.knowledgeDocuments
      });
    }

    if (req.method === 'GET' && req.url === '/api/documents') {
      const db = await readDb();
      return sendJson(res, 200, { documents: db.knowledgeDocuments || [] });
    }

    if (req.method === 'POST' && req.url === '/api/documents') {
      const { title, content, tags } = await readRequestBody(req);
      if (!title || !content) return sendJson(res, 400, { error: 'title und content sind erforderlich.' });

      const db = await readDb();
      const document = {
        id: db.counters.document++,
        title,
        content,
        tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
        createdAt: new Date().toISOString()
      };

      db.knowledgeDocuments.push(document);
      await writeDb(db);
      return sendJson(res, 201, document);
    }

    if (req.method === 'POST' && req.url === '/api/routing-groups') {
      const { name, keywords } = await readRequestBody(req);
      if (!name) return sendJson(res, 400, { error: 'name ist erforderlich.' });

      const db = await readDb();
      const group = {
        id: db.counters.group++,
        name,
        keywords: Array.isArray(keywords) ? keywords.filter(Boolean) : []
      };
      db.routingGroups.push(group);
      await writeDb(db);
      return sendJson(res, 201, group);
    }

    if (req.method === 'PUT' && req.url === '/api/ai-config') {
      const payload = await readRequestBody(req);
      const db = await readDb();
      db.aiConfig = {
        ...db.aiConfig,
        ...payload,
        temperature: Number(payload.temperature ?? db.aiConfig.temperature),
        maxTokens: Number(payload.maxTokens ?? db.aiConfig.maxTokens)
      };
      await writeDb(db);
      return sendJson(res, 200, db.aiConfig);
    }

    if (req.method === 'POST' && req.url === '/api/analyze') {
      const { emailText, provider } = await readRequestBody(req);
      if (!emailText || typeof emailText !== 'string') return sendJson(res, 400, { error: 'emailText ist erforderlich.' });

      const db = await readDb();
      const relevantKnowledge = getRelevantKnowledge(emailText, db.knowledgeDocuments || []);
      let group = detectGroupKeywordBased(emailText, db.routingGroups);
      let classificationReason = 'Keyword-basierte Zuordnung';
      let result;

      try {
        if (provider === 'openai') {
          const classification = await classifyGroupWithOpenAI(emailText, db.routingGroups, db.aiConfig);
          group = classification.group;
          classificationReason = classification.reason;

          result = {
            group,
            responseText: await generateOpenAIReply(emailText, group, db.aiConfig, relevantKnowledge),
            providerUsed: 'openai',
            modelNotice: db.aiConfig.openaiModel,
            classificationReason
          };
        } else {
          result = {
            group,
            responseText: generateRuleBasedReply(emailText, group, relevantKnowledge),
            providerUsed: 'rule-based',
            modelNotice: 'Lokale regelbasierte Logik',
            classificationReason
          };
        }
      } catch (error) {
        result = {
          group,
          responseText: generateRuleBasedReply(emailText, group, relevantKnowledge),
          providerUsed: 'rule-based-fallback',
          modelNotice: `Fallback aktiv: ${error.message}`,
          classificationReason
        };
      }

      const analysisId = db.counters.analysis++;
      db.analyses.push({
        id: analysisId,
        emailText,
        predictedGroup: result.group,
        generatedResponse: result.responseText,
        llmProvider: result.providerUsed,
        modelNotice: result.modelNotice,
        classificationReason: result.classificationReason,
        matchedKnowledgeDocumentIds: relevantKnowledge.map((doc) => doc.id),
        createdAt: new Date().toISOString()
      });
      await writeDb(db);
      return sendJson(res, 200, { ...result, analysisId });
    }

    if (req.method === 'POST' && req.url === '/api/feedback') {
      const { analysisId, rating, correctionGroup, correctionResponse, note } = await readRequestBody(req);
      if (!analysisId) return sendJson(res, 400, { error: 'analysisId ist erforderlich.' });

      const db = await readDb();
      if (!db.analyses.find((item) => item.id === Number(analysisId))) return sendJson(res, 404, { error: 'Analyse nicht gefunden.' });

      const feedbackId = db.counters.feedback++;
      db.feedback.push({
        id: feedbackId,
        analysisId: Number(analysisId),
        rating: rating || null,
        correctionGroup: correctionGroup || null,
        correctionResponse: correctionResponse || null,
        note: note || null,
        createdAt: new Date().toISOString()
      });
      await writeDb(db);
      return sendJson(res, 200, { success: true, feedbackId });
    }

    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const safePath = path.normalize(urlPath).replace(/^\.\.(\/|\\|$)/, '');
    const filePath = path.join(publicDir, safePath);

    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    try {
      await fs.access(filePath);
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (error) {
    sendJson(res, 500, { error: `Serverfehler: ${error.message}` });
  }
});

ensureDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
  });
});
