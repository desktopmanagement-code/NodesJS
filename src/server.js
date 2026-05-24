import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { handleWebDAV } from './webdav.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 80;
const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '..', 'data', 'storage');

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
    console.log(`WebDAV-Server läuft auf Port ${PORT}`);
    console.log(`Speicherverzeichnis: ${STORAGE_DIR}`);
    console.log('');
    console.log('Noch kein Benutzer angelegt? Befehl:');
    console.log('  node src/cli.js add <benutzername> <passwort>');
    console.log('');
    console.log('Windows Netzlaufwerk verbinden:');
    console.log(`  net use Z: http://192.168.7.1/ /user:<benutzer> <passwort> /persistent:yes`);
  });
}

main().catch((err) => {
  console.error('Startfehler:', err.message);
  process.exit(1);
});
