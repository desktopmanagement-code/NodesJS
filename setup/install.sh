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

# dnsmasq prüfen / installieren
if ! command -v dnsmasq &>/dev/null; then
  echo "Installiere dnsmasq..."
  apt-get install -y dnsmasq
fi

# dnsmasq für USB konfigurieren
cp "$INSTALL_DIR/setup/dnsmasq-usb.conf" /etc/dnsmasq.d/pi-webdav-usb.conf
systemctl enable dnsmasq
systemctl restart dnsmasq

# Verzeichnisse anlegen
mkdir -p "$INSTALL_DIR/data/storage"

# Systemd-Units installieren (Pfad einsetzen)
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
echo "3) Auf Windows (CMD als Administrator):"
echo "   net use Z: http://192.168.7.1/ /user:admin <passwort> /persistent:yes"
echo ""
echo "   Falls Fehler 'Netzwerkpfad nicht gefunden':"
echo "   Schritt 1: Windows-Dienst 'WebClient' starten:"
echo "     sc start WebClient"
echo "   Schritt 2: Registry-Eintrag für HTTP-Authentifizierung:"
echo "     reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters"
echo "         /v BasicAuthLevel /t REG_DWORD /d 2 /f"
echo "     sc stop WebClient && sc start WebClient"
