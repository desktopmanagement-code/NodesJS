#!/bin/bash
# Erstellt das FAT32-Image das Windows als USB-Laufwerk sieht.
# Ausführen einmalig: sudo bash setup/create-image.sh [Größe in MB, Standard: 2048]
set -e

INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="$INSTALL_DIR/data/usb-storage.img"
SIZE_MB=${1:-2048}  # Standard: 2 GB

if [ -f "$IMAGE" ]; then
  echo "Image existiert bereits: $IMAGE"
  echo "Größe: $(du -sh "$IMAGE" | cut -f1)"
  echo "Zum Neu-Erstellen zuerst löschen: rm $IMAGE"
  exit 0
fi

mkdir -p "$INSTALL_DIR/data"

echo "Erstelle ${SIZE_MB} MB FAT32-Image..."
dd if=/dev/zero of="$IMAGE" bs=1M count="$SIZE_MB" status=progress

mkfs.fat -F 32 -n "PI_STORAGE" "$IMAGE"

echo ""
echo "Image erstellt: $IMAGE"
echo "Windows sieht das Laufwerk als 'PI_STORAGE' ($(( SIZE_MB / 1024 )) GB)."
