# CLAUDE.md — Pi WebDAV

## Was das Projekt macht

Raspberry Pi erscheint bei Windows per USB als Netzwerkadapter (RNDIS-Gadget). Über diesen USB-Kanal betreibt Node.js einen WebDAV-Server. Windows mappt diesen als Netzlaufwerk — sieht für den Nutzer aus wie ein USB-Stick im Explorer.

**Zwei Windows-Computer greifen gleichzeitig auf dieselben Dateien zu:**

| | Windows 1 | Windows 2 |
|---|---|---|
| Verbindung | USB-Kabel → RNDIS-Adapter | WiFi / Ethernet |
| URL | `http://192.168.7.1/` | `http://<wlan-ip>/` |
| Protokoll | WebDAV über USB-Netz | WebDAV über Heimnetz |
| Pi-Server | **derselbe**, Port 80 | **derselbe**, Port 80 |

> **Warum nicht USB-Mass-Storage?** Bei Mass-Storage hat Windows exklusiven Block-Zugriff auf die Partition — der Pi kann nicht gleichzeitig lesen/schreiben (Korruptionsgefahr). RNDIS erstellt stattdessen einen virtuellen Netzwerkadapter über USB: beide Windows-PCs sehen ein Laufwerk, greifen aber über WebDAV zu, das echten simultanen Zugriff erlaubt.

Kein Browser-UI. Kein npm-Paket. Nur Node.js-Built-ins.

---

## Verzeichnisstruktur

```
pi-webdav/
├── src/
│   ├── server.js      # HTTP-Server, startet WebDAV + Auth
│   ├── webdav.js      # Alle WebDAV-Methoden (RFC 4918)
│   ├── auth.js        # HTTP Basic Auth (prüft Passwort gegen users.json)
│   ├── users.js       # Benutzerverwaltung (scrypt-Hash, users.json)
│   └── cli.js         # Kommandozeilen-Tool für Benutzerverwaltung
├── setup/
│   ├── gadget.sh          # Aktiviert USB RNDIS-Gadget via configfs
│   ├── dnsmasq-usb.conf   # DHCP für usb0-Interface
│   ├── install.sh         # Richtet systemd-Dienste ein
│   ├── pi-gadget.service  # systemd: USB-Gadget beim Boot
│   └── pi-webdav.service  # systemd: Node.js WebDAV-Server
├── data/
│   ├── users.json     # Benutzerdaten (auto-erstellt)
│   └── storage/       # Geteiltes Verzeichnis (WebDAV-Wurzel)
└── package.json
```

---

## Tech Stack

| Schicht | Technologie |
|---|---|
| Laufzeit | Node.js (ES-Module, `"type": "module"`) |
| HTTP-Server | `node:http` — kein Framework |
| Passwort-Hashing | `node:crypto` scrypt |
| USB-Gadget | Linux configfs / RNDIS |
| DHCP | dnsmasq |
| Persistenz | `data/users.json` (Passwörter), `data/storage/` (Dateien) |
| npm-Pakete | **Keine** |

---

## Server starten

```bash
npm start        # Produktion (Port 80, braucht root)
npm run dev      # Entwicklung mit Auto-Reload
```

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `80` | HTTP-Port |
| `STORAGE_DIR` | `data/storage` | Absoluter Pfad zum Dateiverzeichnis |

---

## Benutzerverwaltung (CLI)

```bash
node src/cli.js add    <benutzer>   # Benutzer anlegen (Passwort wird interaktiv abgefragt)
node src/cli.js passwd <benutzer>   # Passwort ändern
node src/cli.js remove <benutzer>   # Benutzer löschen
node src/cli.js list                # Alle Benutzer anzeigen
```

Passwörter werden mit scrypt (N=16384, r=8, p=1, 64 Byte) gehasht. Benutzernamen: nur `[a-zA-Z0-9_-]`.

---

## Raspberry Pi einrichten

### Voraussetzungen (einmalig in `/boot/config.txt` bzw. `/boot/firmware/config.txt`)

```
dtoverlay=dwc2
```

Und in `/etc/modules`:
```
dwc2
```

Dann neu starten.

### Installation

```bash
sudo bash setup/install.sh
```

Das Skript:
1. Prüft Node.js
2. Installiert dnsmasq und kopiert `setup/dnsmasq-usb.conf`
3. Registriert `pi-gadget.service` und `pi-webdav.service` als systemd-Dienste

### Ersten Benutzer anlegen

```bash
node src/cli.js add admin
```

### Dienste starten

```bash
sudo systemctl start pi-gadget
sudo systemctl start pi-webdav
```

---

## Windows verbinden

### Windows 1 — per USB-Kabel

USB-Kabel einstecken → Windows installiert RNDIS-Treiber automatisch → Pi erscheint als USB-Netzwerkadapter → Pi-IP: `192.168.7.1`

**CMD als Administrator:**
```bat
sc start WebClient
net use Z: http://192.168.7.1/ /user:admin <passwort> /persistent:yes
```

### Windows 2 — per WLAN / Ethernet

Pi muss im selben Netzwerk sein. Die IP des Pi auf dem Startbildschirm ablesen (`wlan0` oder `eth0`).

**CMD als Administrator:**
```bat
sc start WebClient
net use Y: http://<wlan-ip-des-pi>/ /user:admin <passwort> /persistent:yes
```

### Registry-Fix (einmalig auf jedem Windows, falls Fehler `Netzwerkpfad nicht gefunden`)

```bat
reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v BasicAuthLevel /t REG_DWORD /d 2 /f
sc stop WebClient && sc start WebClient
```

---

## Architektur

```
Windows Explorer / net use
        │  HTTP Basic Auth + WebDAV (RFC 4918)
        │  über USB (RNDIS = virtuelles Ethernet)
        ▼
   src/server.js          ← startet HTTP-Server, ruft authenticate() auf
        │
        ├─► src/auth.js   ← parst Authorization-Header, prüft gegen users.json
        │
        └─► src/webdav.js ← verarbeitet WebDAV-Methoden
                │
                └─► data/storage/   ← Dateisystem (Wurzel des Laufwerks)
```

---

## Implementierte WebDAV-Methoden

| Methode | Funktion |
|---|---|
| `OPTIONS` | Fähigkeiten melden (DAV: 1, 2) |
| `PROPFIND` | Verzeichnis-/Datei-Eigenschaften (Depth 0, 1, infinity) |
| `GET` / `HEAD` | Datei herunterladen |
| `PUT` | Datei hochladen (erstellt Verzeichnisse automatisch) |
| `DELETE` | Datei oder Verzeichnis löschen |
| `MKCOL` | Verzeichnis erstellen |
| `MOVE` | Verschieben / Umbenennen |
| `COPY` | Kopieren (rekursiv) |
| `LOCK` / `UNLOCK` | Lock-Token für Windows (in-memory, kein echtes Locking) |
| `PROPPATCH` | Acknowledged ohne Änderung (minimale Implementierung) |

---

## Konventionen

- **ES-Module** — nur `import`/`export`, kein `require()`.
- **`__dirname`-Shim** — `path.dirname(fileURLToPath(import.meta.url))` verwenden.
- **Keine npm-Pakete** — ausschließlich Node.js-Built-ins.
- **Pfad-Traversal-Schutz** — `resolvePath()` in `webdav.js` stellt sicher, dass alle Pfade innerhalb von `STORAGE_DIR` bleiben.
- **Passwörter nie im Klartext** — scrypt-Hash mit zufälligem Salt in `users.json`.
- **`MS-Author-Via: DAV`-Header** — wichtig für Windows-Kompatibilität, in jedem Response gesetzt.

---

## Häufige Aufgaben

### Neues WebDAV-Verzeichnis (anderes Laufwerk)
`STORAGE_DIR=/mnt/externe-platte node src/server.js`

### Log-Ausgabe der Dienste
```bash
journalctl -u pi-webdav -f
journalctl -u pi-gadget -f
```

### Gadget manuell testen (ohne Reboot)
```bash
sudo bash setup/gadget.sh
sudo systemctl start pi-webdav
```
