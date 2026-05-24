import fs from 'node:fs/promises';
import path from 'node:path';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const IMAGE_FILE  = path.resolve(process.env.IMAGE_FILE  ?? path.join(ROOT, 'data/usb-storage.img'));
const USB_MOUNT   = path.resolve(process.env.USB_MOUNT   ?? path.join(ROOT, 'data/usb-mount'));
const WEBDAV_DIR  = path.resolve(process.env.STORAGE_DIR ?? path.join(ROOT, 'data/storage'));
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL ?? '15000');

// Prüft ob Windows 1 das Laufwerk gerade aktiv gemountet hat.
// UDC-State "configured" = Windows hat es eingebunden und schreibt evtl. gerade.
async function isWindowsUsing() {
  try {
    const udcs = await fs.readdir('/sys/class/udc');
    for (const udc of udcs) {
      try {
        const state = (await fs.readFile(`/sys/class/udc/${udc}/state`, 'utf-8')).trim();
        if (state === 'configured') return true;
      } catch { /* einzelner UDC nicht lesbar */ }
    }
  } catch { /* /sys/class/udc nicht vorhanden (kein Gadget-System) */ }
  return false;
}

async function isAlreadyMounted() {
  try {
    const mounts = await fs.readFile('/proc/mounts', 'utf-8');
    return mounts.includes(USB_MOUNT);
  } catch {
    return false;
  }
}

// Kopiert eine Datei von src nach dest, aber nur wenn src neuer ist.
async function syncFile(src, dest) {
  const [srcStat, destStat] = await Promise.allSettled([fs.stat(src), fs.stat(dest)]);
  if (srcStat.status === 'rejected') return; // Quelle verschwunden

  const srcMtime = srcStat.value.mtimeMs;
  const destMtime = destStat.status === 'fulfilled' ? destStat.value.mtimeMs : 0;

  if (srcMtime > destMtime) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    const t = new Date(srcMtime);
    await fs.utimes(dest, t, t); // Änderungszeit übernehmen
  }
}

async function syncDirs(srcDir, destDir) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return; // Verzeichnis nicht lesbar
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // FAT32-Metadateien und hidden files überspringen

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await syncDirs(srcPath, destPath);
    } else if (entry.isFile()) {
      await syncFile(srcPath, destPath);
    }
  }
}

let syncRunning = false;

async function runSync() {
  if (syncRunning) return; // kein paralleler Sync
  syncRunning = true;

  let mounted = false;
  try {
    // Image-Datei vorhanden?
    await fs.access(IMAGE_FILE);

    // Windows nutzt das Laufwerk gerade → überspringen
    if (await isWindowsUsing()) return;

    // Schon gemountet (vorheriger Sync abgestürzt?) → aufräumen
    if (await isAlreadyMounted()) {
      await exec(`umount "${USB_MOUNT}"`).catch(() => {});
    }

    await fs.mkdir(USB_MOUNT, { recursive: true });
    await exec(`mount -o loop "${IMAGE_FILE}" "${USB_MOUNT}"`);
    mounted = true;

    // Beide Richtungen: neuere Datei gewinnt
    await syncDirs(USB_MOUNT, WEBDAV_DIR); // USB-Laufwerk → WebDAV
    await syncDirs(WEBDAV_DIR, USB_MOUNT); // WebDAV → USB-Laufwerk

    console.log(`[sync] ${new Date().toISOString().slice(11, 19)} OK`);
  } catch (err) {
    if (err.code !== 'ENOENT') { // ENOENT = Image noch nicht erstellt, kein Fehler
      console.error(`[sync] Fehler: ${err.message}`);
    }
  } finally {
    if (mounted) {
      await exec(`umount "${USB_MOUNT}"`).catch((e) => {
        console.error(`[sync] umount fehlgeschlagen: ${e.message}`);
      });
    }
    syncRunning = false;
  }
}

export function startSyncDaemon() {
  console.log(`[sync] Daemon gestartet – Intervall: ${INTERVAL_MS / 1000}s`);
  console.log(`[sync] Image:   ${IMAGE_FILE}`);
  console.log(`[sync] WebDAV:  ${WEBDAV_DIR}`);

  setTimeout(runSync, 3000); // erster Sync nach 3 Sekunden (Gadget-Start abwarten)
  setInterval(runSync, INTERVAL_MS);
}
