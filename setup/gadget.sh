#!/bin/bash
# Konfiguriert den Pi als USB Mass Storage Gerät (USB-Stick für Windows).
# Voraussetzung: data/usb-storage.img muss existieren (setup/create-image.sh).
# Ausführen als root: sudo bash setup/gadget.sh
set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="$INSTALL_DIR/data/usb-storage.img"
GADGET_DIR="/sys/kernel/config/usb_gadget/pi_webdav"

if [ ! -f "$IMAGE" ]; then
  echo "Fehler: $IMAGE nicht gefunden."
  echo "Bitte zuerst ausführen: sudo bash setup/create-image.sh"
  exit 1
fi

modprobe libcomposite

# Altes Gadget entfernen
if [ -d "$GADGET_DIR" ]; then
  echo "" > "${GADGET_DIR}/UDC" 2>/dev/null || true
  sleep 0.5
  rm -rf "$GADGET_DIR"
fi

mkdir -p "$GADGET_DIR"
cd "$GADGET_DIR"

echo 0x1d6b > idVendor    # Linux Foundation
echo 0x0104 > idProduct   # Multifunction Composite Gadget
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

mkdir -p strings/0x409
echo "fedcba9876543210"  > strings/0x409/serialnumber
echo "Raspberry Pi"      > strings/0x409/manufacturer
echo "Pi WebDAV"         > strings/0x409/product

mkdir -p configs/c.1/strings/0x409
echo "Mass Storage" > configs/c.1/strings/0x409/configuration
echo 250            > configs/c.1/MaxPower

# Mass Storage Funktion
mkdir -p functions/mass_storage.usb0
echo 0          > functions/mass_storage.usb0/stall         # kein STALL-Protokoll
echo 0          > functions/mass_storage.usb0/lun.0/cdrom
echo 0          > functions/mass_storage.usb0/lun.0/ro      # read/write
echo 1          > functions/mass_storage.usb0/lun.0/removable
echo "$IMAGE"   > functions/mass_storage.usb0/lun.0/file

ln -sf "${GADGET_DIR}/functions/mass_storage.usb0" configs/c.1/

# Gadget aktivieren
ls /sys/class/udc | head -1 > UDC

echo "Gadget aktiv. Windows erkennt jetzt ein USB-Laufwerk."
echo "Image: $IMAGE"
