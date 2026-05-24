import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scryptAsync = promisify(scrypt);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersFile = path.join(__dirname, '..', 'data', 'users.json');

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

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(username, password) {
  const users = await readUsers();
  const hash = users[username];
  if (!hash) return false;
  const [salt, storedKey] = hash.split(':');
  try {
    const derived = await scryptAsync(password, salt, 64);
    return timingSafeEqual(derived, Buffer.from(storedKey, 'hex'));
  } catch {
    return false;
  }
}

export async function addUser(username, password) {
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error(`Ungültiger Benutzername: nur a-z, A-Z, 0-9, _ und - erlaubt.`);
  const users = await readUsers();
  if (users[username]) throw new Error(`Benutzer "${username}" existiert bereits.`);
  users[username] = await hashPassword(password);
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
  users[username] = await hashPassword(newPassword);
  await writeUsers(users);
}

export async function listUsers() {
  return Object.keys(await readUsers());
}
