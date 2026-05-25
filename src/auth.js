import { createHash, randomBytes } from 'node:crypto';
import { getHA1, REALM } from './users.js';

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

function parseDigestHeader(header) {
  const params = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    params[m[1]] = m[2] ?? m[3];
  }
  return params;
}

function sendChallenge(res) {
  const nonce = randomBytes(16).toString('hex');
  res.writeHead(401, {
    'WWW-Authenticate': `Digest realm="${REALM}", nonce="${nonce}", algorithm=MD5, qop="auth"`,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Anmeldung erforderlich.');
}

export async function authenticate(req, res) {
  const header = req.headers['authorization'] ?? '';

  if (!header.startsWith('Digest ')) {
    sendChallenge(res);
    return null;
  }

  const p = parseDigestHeader(header.slice(7));
  const { username, nonce, uri, response, qop, nc, cnonce } = p;

  if (!username || !nonce || !uri || !response) {
    sendChallenge(res);
    return null;
  }

  const ha1 = await getHA1(username);
  if (!ha1) {
    sendChallenge(res);
    return null;
  }

  const ha2 = md5(`${req.method}:${uri}`);
  const expected = qop === 'auth'
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  if (response !== expected) {
    sendChallenge(res);
    return null;
  }

  return username;
}
