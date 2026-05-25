import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersFile = path.join(__dirname, '..', 'data', 'users.json');

export const REALM = 'Pi WebDAV';

// Digest Auth benötigt HA1 = MD5(username:realm:password) serverseitig gespeichert.
function computeHA1(username, password) {
  return createHash('md5').update(`${username}:${REALM}:${password}`).digest('hex');
}

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(usersFile, 'utf-8'));
  } catch {
    return {};
  }
}

async function writeUsers(users) {
  await fs.mkdir(path.dirname(usersFile), { recursive: true });
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2), 'utf-8');
}

export async function getHA1(username) {
  const users = await readUsers();
  return users[username] ?? null;
}

export async function verifyPassword(username, password) {
  const users = await readUsers();
  const stored = users[username];
  if (!stored) return false;
  return stored === computeHA1(username, password);
}

export async function addUser(username, password) {
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error('Ungültiger Benutzername: nur a-z, A-Z, 0-9, _ und - erlaubt.');
  const users = await readUsers();
  if (users[username]) throw new Error(`Benutzer "${username}" existiert bereits.`);
  users[username] = computeHA1(username, password);
  await writeUsers(users);
}

export async function removeUser(username) {
  const users = await readUsers();
  if (!users[username]) throw new Error(`Benutzer "${username}" nicht gefunden.`);
  delete users[username];
  await writeUsers(users);
}

export async function changePassword(username, newPassword) {
  const users = await readUsers();
  if (!users[username]) throw new Error(`Benutzer "${username}" nicht gefunden.`);
  users[username] = computeHA1(username, newPassword);
  await writeUsers(users);
}

export async function listUsers() {
  return Object.keys(await readUsers());
}
