import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// In-memory lock store: token -> { filePath, createdAt }
const locks = new Map();

// Purge expired locks every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [token, lock] of locks) {
    if (lock.createdAt < cutoff) locks.delete(token);
  }
}, 600_000).unref();

function resolvePath(storageDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    decoded = urlPath;
  }
  const resolved = path.resolve(path.join(storageDir, decoded));
  const base = path.resolve(storageDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Path traversal');
  }
  return resolved;
}

function encodeHref(urlPath) {
  return urlPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MIME = {
  '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain',
  '.md': 'text/plain', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function davHeaders() {
  return {
    DAV: '1, 2',
    'MS-Author-Via': 'DAV',
    Allow: 'OPTIONS, HEAD, GET, PUT, DELETE, MKCOL, MOVE, COPY, PROPFIND, PROPPATCH, LOCK, UNLOCK',
  };
}

async function buildPropXml(filePath, urlHref) {
  const stat = await fs.stat(filePath);
  const isDir = stat.isDirectory();
  const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
  const lastMod = stat.mtime.toUTCString();
  const name = path.basename(filePath) || '/';
  const href = isDir && !urlHref.endsWith('/') ? `${encodeHref(urlHref)}/` : encodeHref(urlHref);

  const resourceType = isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
  const contentProps = isDir
    ? ''
    : `<D:getcontentlength>${stat.size}</D:getcontentlength>` +
      `<D:getcontenttype>${mimeType(filePath)}</D:getcontenttype>`;

  return `<D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(name)}</D:displayname>
        ${resourceType}
        ${contentProps}
        <D:getlastmodified>${lastMod}</D:getlastmodified>
        <D:getetag>${etag}</D:getetag>
        <D:creationdate>${stat.birthtime.toISOString()}</D:creationdate>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

async function collectProps(filePath, urlPath, depth) {
  const results = [];
  try {
    results.push(await buildPropXml(filePath, urlPath));
    if (depth > 0) {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(filePath);
        for (const entry of entries) {
          const childFile = path.join(filePath, entry);
          const childUrl = urlPath.endsWith('/') ? `${urlPath}${entry}` : `${urlPath}/${entry}`;
          // depth - 1 so infinity becomes a large-but-finite crawl with the caller's cap
          const sub = await collectProps(childFile, childUrl, depth - 1);
          results.push(...sub);
        }
      }
    }
  } catch {
    // skip unreadable entries
  }
  return results;
}

function multistatus(responses) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">\n${responses.join('\n')}\n</D:multistatus>`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function handleWebDAV(req, res, storageDir) {
  const method = req.method.toUpperCase();
  const urlPath = req.url.split('?')[0];

  let filePath;
  try {
    filePath = resolvePath(storageDir, urlPath);
  } catch {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // ── OPTIONS ──────────────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    res.writeHead(200, { ...davHeaders(), 'Content-Length': '0' });
    return res.end();
  }

  // ── PROPFIND ─────────────────────────────────────────────────────────────
  if (method === 'PROPFIND') {
    try {
      await fs.access(filePath);
    } catch {
      res.writeHead(404);
      return res.end('Not Found');
    }

    const depthHeader = req.headers['depth'] ?? '1';
    const depth = depthHeader === 'infinity' ? 10 : Number(depthHeader);

    const responses = await collectProps(filePath, urlPath, depth);
    const body = multistatus(responses);

    res.writeHead(207, {
      ...davHeaders(),
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf-8'),
    });
    return res.end(body);
  }

  // ── HEAD / GET ────────────────────────────────────────────────────────────
  if (method === 'HEAD' || method === 'GET') {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      res.writeHead(404);
      return res.end('Not Found');
    }

    if (stat.isDirectory()) {
      const entries = await fs.readdir(filePath);
      const items = entries
        .map((e) => `<li><a href="${encodeURIComponent(e)}">${escapeXml(e)}</a></li>`)
        .join('');
      const body = `<!DOCTYPE html><html><body><ul>${items}</ul></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(method === 'HEAD' ? undefined : body);
    }

    const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
    res.writeHead(200, {
      ...davHeaders(),
      'Content-Type': mimeType(filePath),
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString(),
      ETag: etag,
    });
    if (method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
    return;
  }

  // ── PUT ───────────────────────────────────────────────────────────────────
  if (method === 'PUT') {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = createWriteStream(filePath);
      req.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      req.on('error', reject);
    });
    res.writeHead(201, davHeaders());
    return res.end();
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      res.writeHead(404);
      return res.end('Not Found');
    }
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    res.writeHead(204, davHeaders());
    return res.end();
  }

  // ── MKCOL ─────────────────────────────────────────────────────────────────
  if (method === 'MKCOL') {
    // MKCOL must not have a body per RFC 4918
    const body = await readBody(req);
    if (body.length > 0) {
      res.writeHead(415);
      return res.end('Unsupported Media Type');
    }
    try {
      await fs.mkdir(filePath);
    } catch (err) {
      if (err.code === 'EEXIST') { res.writeHead(405); return res.end('Method Not Allowed'); }
      if (err.code === 'ENOENT') { res.writeHead(409); return res.end('Conflict'); }
      throw err;
    }
    res.writeHead(201, davHeaders());
    return res.end();
  }

  // ── MOVE / COPY ───────────────────────────────────────────────────────────
  if (method === 'MOVE' || method === 'COPY') {
    const destHeader = req.headers['destination'];
    if (!destHeader) { res.writeHead(400); return res.end('Missing Destination header'); }

    let destUrl;
    try {
      destUrl = new URL(destHeader).pathname;
    } catch {
      destUrl = destHeader;
    }

    let destPath;
    try {
      destPath = resolvePath(storageDir, destUrl);
    } catch {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    const overwrite = req.headers['overwrite'] !== 'F';

    try {
      await fs.access(destPath);
      if (!overwrite) { res.writeHead(412); return res.end('Precondition Failed'); }
      const ds = await fs.stat(destPath);
      if (ds.isDirectory()) await fs.rm(destPath, { recursive: true });
      else await fs.unlink(destPath);
    } catch { /* destination doesn't exist */ }

    await fs.mkdir(path.dirname(destPath), { recursive: true });

    if (method === 'MOVE') {
      await fs.rename(filePath, destPath);
    } else {
      await copyRecursive(filePath, destPath);
    }
    res.writeHead(201, davHeaders());
    return res.end();
  }

  // ── LOCK ──────────────────────────────────────────────────────────────────
  if (method === 'LOCK') {
    // Create file if it doesn't exist (Windows pre-lock before PUT)
    try {
      await fs.access(filePath);
    } catch {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '');
    }

    const token = `urn:uuid:${randomUUID()}`;
    locks.set(token, { filePath, createdAt: Date.now() });

    const href = encodeHref(urlPath);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${token}</D:href></D:locktoken>
      <D:lockroot><D:href>${href}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;

    res.writeHead(200, {
      ...davHeaders(),
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<${token}>`,
      'Content-Length': Buffer.byteLength(body, 'utf-8'),
    });
    return res.end(body);
  }

  // ── UNLOCK ────────────────────────────────────────────────────────────────
  if (method === 'UNLOCK') {
    const tokenHeader = req.headers['lock-token'] ?? '';
    locks.delete(tokenHeader.replace(/[<>]/g, ''));
    res.writeHead(204, davHeaders());
    return res.end();
  }

  // ── PROPPATCH ─────────────────────────────────────────────────────────────
  if (method === 'PROPPATCH') {
    const href = encodeHref(urlPath);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
</D:multistatus>`;
    res.writeHead(207, {
      ...davHeaders(),
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf-8'),
    });
    return res.end(body);
  }

  res.writeHead(405, davHeaders());
  res.end('Method Not Allowed');
}

async function copyRecursive(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(src)) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    await fs.copyFile(src, dest);
  }
}
