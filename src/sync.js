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

async function isWindowsUsing() {
  try {
    const udcs = await fs.readdir('/sys/class/udc');
    for (const udc of udcs) {
      try {
        const state = (await fs.readFile(`/sys/class/udc/${udc}/state`, 'utf-8')).trim();
        if (state === 'configured') return true;
      } catch { /* einzelner UDC nicht lesbar */ }
    }
  } catch { /* kein Gadget-System */ }
  return false;
}

async function isAlreadyMounted() {
  try {
    return (await fs.readFile('/proc/mounts', 'utf-8')).includes(USB_MOUNT);
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
    if (entry.name.startsWith('.')) continue;
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

async function runSync(reason = 'Intervall') {
  if (syncRunning) return;
  syncRunning = true;

  let mounted = false;
  try {
    await fs.access(IMAGE_FILE);

    if (await isAlreadyMounted()) {
      await exec(`umount "${USB_MOUNT}"`).catch(() => {});
    }

    await fs.mkdir(USB_MOUNT, { recursive: true });

    // Immer read-only – wir schreiben nie ins Image zurück.
    // Sicher selbst wenn Windows 1 das Laufwerk gleichzeitig nutzt.
    await exec(`mount -o loop,ro "${IMAGE_FILE}" "${USB_MOUNT}"`);
    mounted = true;

    await syncDirs(USB_MOUNT, WEBDAV_DIR);

    console.log(`[sync] ${new Date().toISOString().slice(11, 19)} OK (${reason})`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[sync] Fehler: ${err.message}`);
    }
  } finally {
    if (mounted) {
      await exec(`umount "${USB_MOUNT}"`).catch((e) => {
        console.error(`[sync] umount: ${e.message}`);
      });
    }
    syncRunning = false;
  }
}

// Erkennt Auswurf (configured → nicht configured) und löst sofort Sync aus.
let prevConnected = null;
async function pollUDC() {
  const connected = await isWindowsUsing();
  if (prevConnected === true && connected === false) {
    console.log('[sync] Auswurf erkannt → sofortiger Sync');
    runSync('Auswurf');
  }
  prevConnected = connected;
}

export function startSyncDaemon() {
  if (process.platform !== 'linux') {
    console.log('[sync] Nicht Linux – Sync-Daemon deaktiviert.');
    return;
  }

  console.log(`[sync] Daemon gestartet`);
  console.log(`[sync] Richtung:  USB-Image → WebDAV (read-only, nur lesen)`);
  console.log(`[sync] Intervall: ${INTERVAL_MS / 1000}s  +  sofort bei Auswurf`);

  setTimeout(() => runSync('Start'), 3000);
  setInterval(runSync, INTERVAL_MS);
  setInterval(pollUDC, 2000);  // UDC-State-Check: billig, kein mount nötig
}
