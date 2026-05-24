#!/bin/bash
# Konfiguriert den Pi als USB RNDIS-Netzwerkadapter.
# Windows sieht den Pi wie einen USB-Netzwerkadapter und bekommt per DHCP eine IP.
# Ausführen als root: sudo bash setup/gadget.sh
set -e

GADGET_DIR="/sys/kernel/config/usb_gadget/pi_webdav"

modprobe libcomposite

# Altes Gadget entfernen
if [ -d "$GADGET_DIR" ]; then
  echo "" > "${GADGET_DIR}/UDC" 2>/dev/null || true
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
echo "RNDIS Config"  > configs/c.1/strings/0x409/configuration
echo 250             > configs/c.1/MaxPower

# RNDIS-Funktion (Windows-kompatibel)
mkdir -p functions/rndis.usb0
echo "DE:AD:BE:EF:00:01" > functions/rndis.usb0/host_addr   # Windows-seitige MAC
echo "DE:AD:BE:EF:00:02" > functions/rndis.usb0/dev_addr    # Pi-seitige MAC

ln -sf "${GADGET_DIR}/functions/rndis.usb0" configs/c.1/

# Gadget aktivieren (erste verfügbare UDC)
ls /sys/class/udc | head -1 > UDC

# Netzwerkinterface konfigurieren
sleep 1
ip link set usb0 up
ip addr flush dev usb0
ip addr add 192.168.7.1/24 dev usb0

echo "Gadget aktiv. Pi-IP: 192.168.7.1"
echo "Windows bekommt automatisch eine IP im Bereich 192.168.7.x (via dnsmasq)."
