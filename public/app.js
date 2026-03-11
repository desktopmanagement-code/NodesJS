const byId = (id) => document.getElementById(id);

const analyzeBtn = byId('analyzeBtn');
const saveFeedbackBtn = byId('saveFeedbackBtn');
const addGroupBtn = byId('addGroupBtn');
const saveAiConfigBtn = byId('saveAiConfigBtn');

let currentAnalysisId = null;

async function loadConfig() {
  const response = await fetch('/api/config');
  const data = await response.json();

  byId('groupsList').textContent = data.routingGroups
    .map((group) => `${group.name} [${group.keywords.join(', ')}]`)
    .join(' | ');

  byId('openaiModel').value = data.aiConfig.openaiModel;
  byId('temperature').value = data.aiConfig.temperature;
  byId('maxTokens').value = data.aiConfig.maxTokens;
  byId('systemPrompt').value = data.aiConfig.systemPrompt;
  byId('routingPromptTemplate').value = data.aiConfig.routingPromptTemplate;
  byId('replyPromptTemplate').value = data.aiConfig.replyPromptTemplate;
}

analyzeBtn.addEventListener('click', async () => {
  const emailText = byId('emailText').value.trim();
  if (!emailText) {
    byId('status').textContent = 'Bitte zuerst eine Anfrage eingeben.';
    return;
  }

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailText, provider: byId('provider').value })
  });
  const data = await response.json();

  if (!response.ok) {
    byId('status').textContent = data.error || 'Analyse fehlgeschlagen.';
    return;
  }

  currentAnalysisId = data.analysisId;
  byId('groupOutput').value = data.group;
  byId('responseOutput').value = data.responseText;
  byId('modelNotice').textContent = `${data.providerUsed} (${data.modelNotice})`;
  byId('resultSection').classList.remove('hidden');
  byId('status').textContent = 'Analyse abgeschlossen.';
});

saveFeedbackBtn.addEventListener('click', async () => {
  if (!currentAnalysisId) return;

  const payload = {
    analysisId: currentAnalysisId,
    rating: byId('rating').value,
    correctionGroup: byId('groupCorrection').value,
    correctionResponse: byId('responseCorrection').value,
    note: byId('note').value
  };

  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  byId('status').textContent = response.ok && data.success ? 'Feedback gespeichert.' : (data.error || 'Fehler beim Speichern.');
});

addGroupBtn.addEventListener('click', async () => {
  const name = byId('groupName').value.trim();
  const keywords = byId('groupKeywords').value.split(',').map((item) => item.trim()).filter(Boolean);

  const response = await fetch('/api/routing-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, keywords })
  });

  if (response.ok) {
    byId('groupName').value = '';
    byId('groupKeywords').value = '';
    await loadConfig();
  }
});

saveAiConfigBtn.addEventListener('click', async () => {
  const payload = {
    openaiModel: byId('openaiModel').value.trim(),
    temperature: Number(byId('temperature').value),
    maxTokens: Number(byId('maxTokens').value),
    systemPrompt: byId('systemPrompt').value,
    routingPromptTemplate: byId('routingPromptTemplate').value,
    replyPromptTemplate: byId('replyPromptTemplate').value
  };

  const response = await fetch('/api/ai-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  byId('configStatus').textContent = response.ok ? 'KI-Konfiguration gespeichert.' : 'Speichern fehlgeschlagen.';
});

loadConfig();
