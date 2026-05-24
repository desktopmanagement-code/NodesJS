# CLAUDE.md — Pi WebDAV

## Was das Projekt macht

Raspberry Pi teilt ein Verzeichnis mit zwei Windows-Computern gleichzeitig:

| | Windows 1 | Windows 2 |
|---|---|---|
| Verbindung | USB-Kabel | WiFi / Ethernet |
| Pi erscheint als | USB-Laufwerk (Mass Storage) | WebDAV-Netzlaufwerk |
| Protokoll | FAT32-Image via g_mass_storage | WebDAV (HTTP, RFC 4918) |
| Dateien | `data/usb-storage.img` | `data/storage/` |

Ein **Sync-Daemon** hält beide Seiten synchron: sobald Windows 1 das USB-Laufwerk auswirft, mountet der Pi das Image als Loopback, gleicht Änderungen mit `data/storage/` ab und mountet wieder aus.

> **Warum kein RNDIS?** RNDIS (USB-Ethernet-Gadget) würde echten simultanen Zugriff erlauben, funktioniert aber auf manchen Windows-Installationen nicht ohne Treiberinstallation. USB Mass Storage funktioniert auf jedem Windows ohne Treiber.

Kein Browser-UI. Kein npm-Paket. Nur Node.js-Built-ins.

---

## Verzeichnisstruktur

```
pi-webdav/
├── src/
│   ├── server.js      # HTTP-Server, startet WebDAV + Sync-Daemon
│   ├── sync.js        # Sync-Daemon: USB-Image ↔ WebDAV-Verzeichnis
│   ├── webdav.js      # Alle WebDAV-Methoden (RFC 4918)
│   ├── auth.js        # HTTP Basic Auth
│   ├── users.js       # Benutzerverwaltung (scrypt-Hash)
│   └── cli.js         # CLI für Benutzerverwaltung
├── setup/
│   ├── create-image.sh    # Erstellt FAT32-Image (einmalig)
│   ├── gadget.sh          # Aktiviert USB Mass Storage via configfs
│   ├── install.sh         # Richtet systemd-Dienste ein
│   ├── pi-gadget.service  # systemd: USB-Gadget beim Boot
│   └── pi-webdav.service  # systemd: Node.js WebDAV-Server + Sync
├── data/
│   ├── users.json         # Benutzerdaten (auto-erstellt)
│   ├── usb-storage.img    # FAT32-Image – Windows 1 sieht das als USB-Stick
│   ├── usb-mount/         # Temporärer Mountpoint für Sync (leer lassen)
│   └── storage/           # WebDAV-Wurzel – Windows 2 greift hier zu
└── package.json
```

---

## Tech Stack

| Schicht | Technologie |
|---|---|
| Laufzeit | Node.js (ES-Module, `"type": "module"`) |
| HTTP-Server | `node:http` — kein Framework |
| Passwort-Hashing | `node:crypto` scrypt |
| USB-Gadget | Linux configfs / g_mass_storage |
| Sync | Node.js setInterval + `mount -o loop` |
| Persistenz | `data/users.json`, `data/usb-storage.img`, `data/storage/` |
| npm-Pakete | **Keine** |

---

## Erster Start (Reihenfolge)

```bash
# 1. Einmalig: USB-Image erstellen (2 GB FAT32)
sudo bash setup/create-image.sh

# 2. Installation (systemd-Dienste, Verzeichnisse)
sudo bash setup/install.sh

# 3. Benutzer für WebDAV anlegen
node src/cli.js add admin

# 4. Dienste starten
sudo systemctl start pi-gadget   # USB-Laufwerk aktivieren
sudo systemctl start pi-webdav   # WebDAV + Sync starten
```

---

## Benutzerverwaltung (CLI)

```bash
node src/cli.js add    <benutzer>   # Benutzer anlegen (Passwort interaktiv)
node src/cli.js passwd <benutzer>   # Passwort ändern
node src/cli.js remove <benutzer>   # Benutzer löschen
node src/cli.js list                # Alle Benutzer anzeigen
```

---

## Raspberry Pi einrichten

### Voraussetzungen (einmalig)

In `/boot/config.txt` (ältere Pi OS) bzw. `/boot/firmware/config.txt` (Pi OS Bookworm):
```
dtoverlay=dwc2
```

In `/etc/modules`:
```
dwc2
```
Dann neu starten.

---

## Windows 1 verbinden (USB)

USB-Kabel einstecken → Windows erkennt automatisch ein neues USB-Laufwerk (`PI_STORAGE`).
Kein Treiber nötig, kein Einrichten — direkt Dateien hinein- und herauskopieren.

> Dateien sind erst für Windows 2 sichtbar, nachdem Windows 1 das Laufwerk **ausgeworfen** hat und der Pi synchronisiert hat (alle ~15 Sekunden).

---

## Windows 2 verbinden (WebDAV)

Pi muss im selben Netzwerk sein. IP des Pi ablesen: `hostname -I`

**CMD als Administrator:**
```bat
sc start WebClient
net use Z: http://<pi-ip>/ /user:admin <passwort> /persistent:yes
```

Falls Fehler `Netzwerkpfad nicht gefunden` — Registry-Fix (einmalig):
```bat
reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v BasicAuthLevel /t REG_DWORD /d 2 /f
sc stop WebClient && sc start WebClient
```

---

## Architektur: Sync-Ablauf

```
Windows 1 schreibt Datei auf USB-Laufwerk
        │
Windows 1 wirft Laufwerk aus ("Sicher entfernen")
        │
Pi: UDC-State wechselt von "configured" auf anderes
        │ (binnen ~15 Sekunden)
        ▼
Pi: mount -o loop data/usb-storage.img data/usb-mount/
        │
Pi: sync data/usb-mount/ → data/storage/   (USB-Änderungen → WebDAV)
Pi: sync data/storage/   → data/usb-mount/ (WebDAV-Änderungen → USB)
        │
Pi: umount data/usb-mount/
        │
Windows 2 sieht die Datei über WebDAV
```

**Sync-Logik:** Neuere Datei gewinnt (mtime-Vergleich). Keine Löschsynchronisation — gelöschte Dateien auf einer Seite bleiben auf der anderen erhalten.

---

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `80` | HTTP-Port (WebDAV) |
| `STORAGE_DIR` | `data/storage` | WebDAV-Wurzelverzeichnis |
| `IMAGE_FILE` | `data/usb-storage.img` | Pfad zum FAT32-Image |
| `USB_MOUNT` | `data/usb-mount` | Mountpoint für Sync |
| `SYNC_INTERVAL` | `15000` | Sync-Intervall in Millisekunden |

---

## Implementierte WebDAV-Methoden

| Methode | Funktion |
|---|---|
| `OPTIONS` | Fähigkeiten melden (DAV: 1, 2) |
| `PROPFIND` | Verzeichnis-/Datei-Eigenschaften (Depth 0, 1, infinity) |
| `GET` / `HEAD` | Datei herunterladen |
| `PUT` | Datei hochladen |
| `DELETE` | Datei oder Verzeichnis löschen |
| `MKCOL` | Verzeichnis erstellen |
| `MOVE` | Verschieben / Umbenennen |
| `COPY` | Kopieren (rekursiv) |
| `LOCK` / `UNLOCK` | Lock-Token für Windows (in-memory) |
| `PROPPATCH` | Acknowledged ohne Änderung |

---

## Konventionen

- **ES-Module** — nur `import`/`export`, kein `require()`.
- **`__dirname`-Shim** — `path.dirname(fileURLToPath(import.meta.url))` verwenden.
- **Keine npm-Pakete** — ausschließlich Node.js-Built-ins.
- **Pfad-Traversal-Schutz** — `resolvePath()` in `webdav.js` hält alle Pfade innerhalb von `STORAGE_DIR`.
- **Passwörter nie im Klartext** — scrypt-Hash in `users.json`.
- **Sync nur bei ausgeworfenem Laufwerk** — `isWindowsUsing()` prüft UDC-State vor jedem Sync.

---

## Häufige Aufgaben

### Image-Größe ändern (Neustart nötig)
```bash
sudo systemctl stop pi-gadget pi-webdav
rm data/usb-storage.img
sudo bash setup/create-image.sh 4096   # 4 GB
sudo systemctl start pi-gadget pi-webdav
```

### Sync-Intervall anpassen
`SYNC_INTERVAL=5000` in `setup/pi-webdav.service` → `systemctl daemon-reload && systemctl restart pi-webdav`

### Logs ansehen
```bash
journalctl -u pi-webdav -f
journalctl -u pi-gadget -f
```
