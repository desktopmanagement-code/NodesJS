#!/bin/bash
# Vollständige Pi WebDAV Installation – einmalig als root ausführen:
#   sudo bash setup/install_all.sh
set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Ausgabe-Hilfsfunktionen ───────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC}  $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC}  $1"; }
err()  { echo -e "${RED}  ✗${NC}  $1"; exit 1; }
step() { echo ""; echo -e "${YELLOW}──────────────────────────────────────${NC}"; \
         echo -e "${YELLOW}  $1${NC}"; \
         echo -e "${YELLOW}──────────────────────────────────────${NC}"; }

# ── 1. Root-Check ─────────────────────────────────────────────────────────────
[ "$EUID" -eq 0 ] || err "Bitte als root ausführen: sudo bash setup/install_all.sh"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     Pi WebDAV – Installation         ║"
echo "  ╚══════════════════════════════════════╝"

# ── 2. USB-Gadget (dwc2) konfigurieren ───────────────────────────────────────
step "1/7  USB-Gadget konfigurieren"

# Richtige config.txt finden (Bookworm: /boot/firmware, älter: /boot)
if [ -f /boot/firmware/config.txt ]; then
  CONFIG=/boot/firmware/config.txt
elif [ -f /boot/config.txt ]; then
  CONFIG=/boot/config.txt
else
  err "Keine config.txt gefunden."
fi
echo "  Konfigurationsdatei: $CONFIG"

REBOOT_NEEDED=false

# otg_mode=1 auskommentieren (blockiert dwc2 auf Pi 4)
if grep -q "^otg_mode=1" "$CONFIG"; then
  sed -i 's/^otg_mode=1/# otg_mode=1  # deaktiviert für dwc2-Gadget-Modus/' "$CONFIG"
  warn "otg_mode=1 auskommentiert"
  REBOOT_NEEDED=true
fi

# Alte dwc2-Einträge entfernen, korrekten eintragen
if ! grep -q "dtoverlay=dwc2,dr_mode=peripheral" "$CONFIG"; then
  sed -i '/dtoverlay=dwc2/d' "$CONFIG"
  echo "dtoverlay=dwc2,dr_mode=peripheral" >> "$CONFIG"
  ok "dtoverlay=dwc2,dr_mode=peripheral eingetragen"
  REBOOT_NEEDED=true
else
  ok "dwc2 bereits korrekt konfiguriert"
fi

# Kernel-Module
for MODULE in dwc2 libcomposite; do
  if ! grep -q "^${MODULE}$" /etc/modules 2>/dev/null; then
    echo "$MODULE" >> /etc/modules
    ok "$MODULE zu /etc/modules hinzugefügt"
    REBOOT_NEEDED=true
  else
    ok "$MODULE bereits in /etc/modules"
  fi
done

# ── 3. Zeitzone ───────────────────────────────────────────────────────────────
step "2/7  Zeitzone"

CURRENT_TZ=$(timedatectl show --property=Timezone --value 2>/dev/null || echo "unbekannt")
echo "  Aktuelle Zeitzone: $CURRENT_TZ"
echo "  (Wichtig: falsche Zeitzone → Dateizeitstempel um Stunden verschoben)"
echo ""
read -p "  Neue Zeitzone eingeben (z.B. Europe/Berlin) oder Enter zum Beibehalten: " NEW_TZ
if [ -n "$NEW_TZ" ]; then
  timedatectl set-timezone "$NEW_TZ" && ok "Zeitzone gesetzt: $NEW_TZ" || warn "Zeitzone konnte nicht gesetzt werden – manuell prüfen"
else
  ok "Zeitzone beibehalten: $CURRENT_TZ"
fi

# ── 4. Node.js ────────────────────────────────────────────────────────────────
step "3/7  Node.js"

install_nodejs() {
  apt-get update -qq
  apt-get install -y curl ca-certificates gnupg

  # Versuche NodeSource (unterstützt ältere Debian-Versionen besser)
  DISTRO_CODENAME=$(lsb_release -cs 2>/dev/null || echo "")
  NODESOURCE_OK=false

  echo "  Versuche NodeSource..."
  if curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - 2>&1 | grep -q "repository is set up"; then
    NODESOURCE_OK=true
  fi

  if [ "$NODESOURCE_OK" = true ]; then
    apt-get install -y nodejs
  else
    # Fallback: Debian-eigene Pakete (Trixie liefert Node.js 22+)
    warn "NodeSource nicht verfügbar – verwende Debian-Paketquellen"
    apt-get install -y nodejs npm
  fi

  # Version prüfen – muss >= 18 sein
  NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 18 ]; then
    err "Node.js >= 18 erforderlich, gefunden: $(node --version 2>/dev/null || echo 'nicht gefunden'). Bitte manuell installieren: https://nodejs.org"
  fi
}

if command -v node &>/dev/null; then
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    warn "Node.js $(node --version) ist zu alt – wird aktualisiert..."
    install_nodejs
  else
    ok "Node.js bereits installiert: $(node --version)"
  fi
else
  warn "Node.js nicht gefunden – wird installiert..."
  install_nodejs
fi
ok "Node.js: $(node --version)"

# mkfs.fat für Image-Erstellung
if ! command -v mkfs.fat &>/dev/null; then
  warn "dosfstools nicht gefunden – wird installiert..."
  apt-get install -y dosfstools >/dev/null
  ok "dosfstools installiert"
else
  ok "mkfs.fat vorhanden"
fi

# ── 5. FAT32-Image ────────────────────────────────────────────────────────────
step "4/7  USB-Image (FAT32)"

if [ -f "$INSTALL_DIR/data/usb-storage.img" ]; then
  ok "Image bereits vorhanden: $(du -sh "$INSTALL_DIR/data/usb-storage.img" | cut -f1)"
else
  echo ""
  read -p "  Image-Größe in MB (Standard: 2048 = 2 GB): " IMG_SIZE
  IMG_SIZE=${IMG_SIZE:-2048}
  bash "$INSTALL_DIR/setup/create-image.sh" "$IMG_SIZE"
  ok "Image erstellt (${IMG_SIZE} MB)"
fi

# ── 6. Verzeichnisse + systemd-Services ───────────────────────────────────────
step "5/7  Verzeichnisse und Services"

mkdir -p "$INSTALL_DIR/data/storage"
mkdir -p "$INSTALL_DIR/data/usb-mount"
ok "Verzeichnisse angelegt"

sed "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" "$INSTALL_DIR/setup/pi-gadget.service" \
  > /etc/systemd/system/pi-gadget.service

sed "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" "$INSTALL_DIR/setup/pi-webdav.service" \
  > /etc/systemd/system/pi-webdav.service

systemctl daemon-reload
systemctl enable pi-gadget.service pi-webdav.service
ok "Services installiert und für Autostart aktiviert"

# ── 7. WebDAV-Benutzer anlegen ────────────────────────────────────────────────
step "6/7  WebDAV-Benutzer anlegen"

echo ""
read -p "  Benutzername für WebDAV-Zugriff: " DAV_USER
[ -n "$DAV_USER" ] || err "Benutzername darf nicht leer sein."

node "$INSTALL_DIR/src/cli.js" add "$DAV_USER" \
  && ok "Benutzer \"$DAV_USER\" angelegt" \
  || warn "Benutzer konnte nicht angelegt werden (existiert evtl. bereits – mit 'node src/cli.js list' prüfen)"

# ── 8. Services starten / Reboot ─────────────────────────────────────────────
step "7/7  Starten"

if [ "$REBOOT_NEEDED" = true ]; then
  echo ""
  warn "Die USB-Gadget-Konfiguration wurde geändert."
  warn "Ein Neustart ist erforderlich, bevor das USB-Laufwerk funktioniert."
  warn "Die Services starten nach dem Neustart automatisch."
  echo ""
  read -p "  Jetzt neu starten? [J/n]: " DO_REBOOT
  DO_REBOOT=${DO_REBOOT:-J}
  if [[ "$DO_REBOOT" =~ ^[Jj]$ ]]; then
    echo "  Neustart in 3 Sekunden..."
    sleep 3
    reboot
  else
    warn "Bitte manuell neu starten: sudo reboot"
  fi
else
  systemctl start pi-gadget pi-webdav
  ok "Services gestartet"

  PI_IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║  Installation abgeschlossen!                     ║"
  echo "  ╠══════════════════════════════════════════════════╣"
  echo "  ║  Windows 1 (USB):                                ║"
  echo "  ║    USB-Kabel einstecken → Laufwerk PI_STORAGE    ║"
  echo "  ╠══════════════════════════════════════════════════╣"
  echo "  ║  Windows 2 (WebDAV) – CMD als Administrator:     ║"
  printf  "  ║    net use Z: http://%-19s/  ║\n" "$PI_IP"
  printf  "  ║    /user:%-38s  ║\n" "$DAV_USER <passwort>"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo ""
fi
