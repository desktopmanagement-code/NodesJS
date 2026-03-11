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
  - Kontextmodus (optional: letzte X Anfragen + Korrekturen im OpenAI-Prompt)
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


## PR auf GitHub veröffentlichen (ohne Terminal)

1. Öffne das Repository auf GitHub.
2. Wechsle in den Tab **Pull requests**.
3. Klicke auf **New pull request**.
4. Wähle als Vergleich die gewünschte Branch-Kombination (z. B. `main` <- `work`).
5. Prüfe die Änderungen unter **Files changed**.
6. Klicke auf **Create pull request** und bestätige mit Titel/Beschreibung.

Hinweis: Wenn GitHub "merge conflicts" zeigt, zuerst auf **Resolve conflicts** klicken und danach den PR erneut speichern.
