import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { handleWebDAV } from './webdav.js';
import { startSyncDaemon } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT        = Number(process.env.PORT) || 80;
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '..', 'data', 'storage');

function getNetworkIPs() {
  const result = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ iface, ip: addr.address });
      }
    }
  }
  return result;
}

async function main() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const server = http.createServer(async (req, res) => {
    try {
      const user = await authenticate(req, res);
      if (!user) return;
      await handleWebDAV(req, res, STORAGE_DIR);
    } catch (err) {
      console.error(`[${req.method}] ${req.url} →`, err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    }
  });

  server.listen(PORT, () => {
    const ips   = getNetworkIPs();
    const wlanIP = ips.find(({ iface }) => iface.startsWith('wlan'))?.ip;
    const ethIP  = ips.find(({ iface }) => iface.startsWith('eth'))?.ip;
    const netIP  = wlanIP ?? ethIP ?? '<pi-netz-ip>';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║              Pi WebDAV  –  gestartet                ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Port:     ${String(PORT).padEnd(42)}║`);
    console.log(`║  WebDAV:   ${STORAGE_DIR.slice(-42).padEnd(42)}║`);
    console.log('╠══════════════════════════════════════════════════════╣');
    if (ips.length > 0) {
      for (const { iface, ip } of ips) {
        console.log(`║  ${(iface + ':').padEnd(10)} ${ip.padEnd(42)}║`);
      }
    } else {
      console.log('║  (keine aktiven Netzwerk-Interfaces)                 ║');
    }
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log('║  Windows 1 (USB-Laufwerk):  automatisch erkannt     ║');
    console.log('║  Windows 2 (WebDAV):                                 ║');
    console.log(`║    net use Z: http://${String(netIP).padEnd(15)}/ ...         ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  });

  // Sync-Daemon: hält USB-Image und WebDAV-Verzeichnis synchron
  startSyncDaemon();
}

main().catch((err) => {
  console.error('Startfehler:', err.message);
  process.exit(1);
});
