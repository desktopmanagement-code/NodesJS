# NodesJS – Gemeinde-Anfragen Routing + Erstantwort

Diese Version ist auf Bürgeranfragen bei einer **Gemeinde** ausgelegt.

## Funktionen

- Texteingabe für Bürgeranfragen (ohne E-Mail-Konnektoren)
- Auswahl des Verarbeitungsmodus:
  - Regelbasiert lokal
  - OpenAI (optional)
- **KI-gestützte Zielgruppenentscheidung** bei OpenAI-Modus (semantisch, nicht nur per Keywords)
- Ausgabe von:
  - vorgeschlagener Zielgruppe (z.B. Jugend, Ordnungsamt, Bauamt, Standesamt)
  - generierter Erstantwort
- Feedback-Erfassung für kontinuierliche Verbesserung:
  - Bewertung
  - Korrektur Zielgruppe
  - Korrektur Antworttext
  - Kommentar
- Pflege der Routing-Datenbank direkt in der UI:
  - Gruppen anlegen
  - Schlüsselwörter pflegen
- Optimierung von KI-Prompts und Parametern direkt in der UI:
  - Modellname
  - Temperature
  - Max Tokens
  - System Prompt
  - Routing-Prompt-Template
  - Antwort-Prompt-Template
- **Dokumenten-/Wissensspeicher per API (ohne UI)**:
  - Öffnungszeiten
  - aktuelle Schließungen
  - Streiks
  - sonstige Abweichungen
- Persistenz in `data/feedback-db.json`

## Start

```bash
npm start
```

Dann öffnen: `http://localhost:3000`

## Optional: OpenAI aktivieren

```bash
export OPENAI_API_KEY="..."
npm start
```

Wenn kein API-Key gesetzt ist oder OpenAI fehlschlägt, nutzt die App automatisch den lokalen Fallback.

## Dokumente ohne UI pflegen (API)

### Dokumente lesen

```bash
curl -sS http://localhost:3000/api/documents
```

### Dokument anlegen

```bash
curl -sS -X POST http://localhost:3000/api/documents \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Hinweis Streik Bauhof",
    "tags": ["streik", "bauhof", "einschränkung"],
    "content": "Am 14.05. kommt es wegen eines Warnstreiks zu Verzögerungen bei Außendiensten."
  }'
```
