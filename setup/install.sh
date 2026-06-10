#!/bin/bash
# Richtet Pi WebDAV als systemd-Dienst ein.
# Ausführen als root: sudo bash setup/install.sh
set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Installationsverzeichnis: $INSTALL_DIR"

# Node.js prüfen
if ! command -v node &>/dev/null; then
  echo ""
  echo "Fehler: Node.js nicht gefunden."
  echo "Installation:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -"
  echo "  apt-get install -y nodejs"
  exit 1
fi
echo "Node.js: $(node --version)"

# Verzeichnisse anlegen
mkdir -p "$INSTALL_DIR/data/storage"
mkdir -p "$INSTALL_DIR/data/usb-mount"

# FAT32-Image erstellen (falls noch nicht vorhanden)
if [ ! -f "$INSTALL_DIR/data/usb-storage.img" ]; then
  echo "Erstelle USB-Image (2 GB) – das dauert einen Moment..."
  bash "$INSTALL_DIR/setup/create-image.sh"
fi

# Systemd-Units installieren
sed "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" "$INSTALL_DIR/setup/pi-gadget.service" \
  > /etc/systemd/system/pi-gadget.service

sed "s|{{INSTALL_DIR}}|$INSTALL_DIR|g" "$INSTALL_DIR/setup/pi-webdav.service" \
  > /etc/systemd/system/pi-webdav.service

systemctl daemon-reload
systemctl enable pi-gadget.service
systemctl enable pi-webdav.service

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installation abgeschlossen!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1) Ersten Benutzer anlegen:"
echo "   node $INSTALL_DIR/src/cli.js add admin"
echo ""
echo "2) Dienste starten:"
echo "   sudo systemctl start pi-gadget"
echo "   sudo systemctl start pi-webdav"
echo ""
echo "Windows 1 (USB): Kabel einstecken → Pi erscheint als Laufwerk"
echo ""
echo "Windows 2 (WebDAV) – CMD als Administrator:"
echo "  sc start WebClient"
echo "  net use Z: http://<pi-ip>/ /user:admin <passwort> /persistent:yes"
echo ""
echo "  Falls 'Netzwerkpfad nicht gefunden' (einmalig pro Windows):"
echo "  reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters"
echo "      /v BasicAuthLevel /t REG_DWORD /d 2 /f"
echo "  sc stop WebClient && sc start WebClient"
