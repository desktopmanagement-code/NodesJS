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

// "configured" = Windows hat das Laufwerk aktiv eingebunden und schreibt evtl. gerade.
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

// Kopiert src nach dest, aber nur wenn src neuer ist.
async function syncFile(src, dest) {
  const [srcStat, destStat] = await Promise.allSettled([fs.stat(src), fs.stat(dest)]);
  if (srcStat.status === 'rejected') return;

  const srcMtime = srcStat.value.mtimeMs;
  const destMtime = destStat.status === 'fulfilled' ? destStat.value.mtimeMs : 0;

  if (srcMtime > destMtime) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    const t = new Date(srcMtime);
    await fs.utimes(dest, t, t);
  }
}

async function syncDirs(srcDir, destDir) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // FAT32-Metadateien überspringen
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await syncDirs(src, dest);
    } else if (entry.isFile()) {
      await syncFile(src, dest);
    }
  }
}

let syncRunning = false;

async function runSync() {
  if (syncRunning) return;
  syncRunning = true;

  let mounted = false;
  try {
    await fs.access(IMAGE_FILE); // Image noch nicht erstellt → überspringen

    if (await isAlreadyMounted()) {
      // Vorheriger Sync abgestürzt – aufräumen
      await exec(`umount "${USB_MOUNT}"`).catch(() => {});
    }

    await fs.mkdir(USB_MOUNT, { recursive: true });

    const windowsConnected = await isWindowsUsing();

    if (windowsConnected) {
      // Windows nutzt das Laufwerk aktiv → nur lesend mounten, kein Schreiben ins Image
      await exec(`mount -o loop,ro "${IMAGE_FILE}" "${USB_MOUNT}"`);
      mounted = true;
      await syncDirs(USB_MOUNT, WEBDAV_DIR); // USB → WebDAV (neuere Dateien von Windows 1)
      console.log(`[sync] ${new Date().toISOString().slice(11, 19)} USB→WebDAV (read-only, Windows verbunden)`);
    } else {
      // Windows hat ausgeworfen → beidseitiger Sync möglich
      await exec(`mount -o loop,rw "${IMAGE_FILE}" "${USB_MOUNT}"`);
      mounted = true;
      await syncDirs(USB_MOUNT, WEBDAV_DIR); // USB → WebDAV
      await syncDirs(WEBDAV_DIR, USB_MOUNT); // WebDAV → USB (Dateien von Windows 2)
      console.log(`[sync] ${new Date().toISOString().slice(11, 19)} beidseitig (Windows ausgeworfen)`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
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
  if (process.platform !== 'linux') {
    console.log('[sync] Nicht Linux – Sync-Daemon deaktiviert (kein mount -o loop verfügbar).');
    console.log('[sync] WebDAV-Server läuft trotzdem vollständig.');
    return;
  }

  console.log(`[sync] Daemon gestartet – Intervall: ${INTERVAL_MS / 1000}s`);
  console.log(`[sync] Image:  ${IMAGE_FILE}`);
  console.log(`[sync] WebDAV: ${WEBDAV_DIR}`);
  console.log(`[sync] Modus:  Windows verbunden → USB→WebDAV (read-only)`);
  console.log(`[sync]         Windows ausgeworfen → beidseitig (read-write)`);

  setTimeout(runSync, 3000);
  setInterval(runSync, INTERVAL_MS);
}
