import { verifyPassword } from './users.js';

export async function authenticate(req, res) {
  const header = req.headers['authorization'] ?? '';

  if (!header.startsWith('Basic ')) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Pi WebDAV", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Anmeldung erforderlich.');
    return null;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  if (colon === -1) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Ungültiger Authorization-Header.');
    return null;
  }

  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);

  if (!(await verifyPassword(username, password))) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Pi WebDAV", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Ungültiger Benutzername oder Passwort.');
    return null;
  }

  return username;
}
