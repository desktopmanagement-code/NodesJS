#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { addUser, removeUser, listUsers, changePassword } from './users.js';

const [, , command, username] = process.argv;

const HELP = `
Pi WebDAV – Benutzerverwaltung

Befehle:
  add    <benutzer>   Neuen Benutzer anlegen (Passwort wird abgefragt)
  remove <benutzer>   Benutzer löschen
  passwd <benutzer>   Passwort eines Benutzers ändern
  list                Alle Benutzer anzeigen

Beispiele:
  node src/cli.js add alice
  node src/cli.js list
  node src/cli.js passwd alice
  node src/cli.js remove alice
`;

async function promptPassword(label = 'Passwort: ') {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(label);
  // Disable echo if TTY
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  return new Promise((resolve) => {
    let input = '';
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (char) => {
      if (char === '\r' || char === '\n' || char === '') {
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        if (char === '') { process.exit(0); }
        resolve(input);
      } else if (char === '' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.on('data', onData);
    } else {
      // Non-TTY (piped): just read line normally
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
    }
  });
}

async function run() {
  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'add': {
        if (!username) { console.error('Fehler: Benutzername erforderlich.'); process.exit(1); }
        const pw = await promptPassword(`Passwort für "${username}": `);
        const pw2 = await promptPassword('Passwort bestätigen: ');
        if (pw !== pw2) { console.error('Fehler: Passwörter stimmen nicht überein.'); process.exit(1); }
        if (pw.length < 4) { console.error('Fehler: Passwort muss mindestens 4 Zeichen lang sein.'); process.exit(1); }
        await addUser(username, pw);
        console.log(`Benutzer "${username}" wurde angelegt.`);
        break;
      }

      case 'remove': {
        if (!username) { console.error('Fehler: Benutzername erforderlich.'); process.exit(1); }
        await removeUser(username);
        console.log(`Benutzer "${username}" wurde gelöscht.`);
        break;
      }

      case 'passwd': {
        if (!username) { console.error('Fehler: Benutzername erforderlich.'); process.exit(1); }
        const pw = await promptPassword(`Neues Passwort für "${username}": `);
        const pw2 = await promptPassword('Passwort bestätigen: ');
        if (pw !== pw2) { console.error('Fehler: Passwörter stimmen nicht überein.'); process.exit(1); }
        if (pw.length < 4) { console.error('Fehler: Passwort muss mindestens 4 Zeichen lang sein.'); process.exit(1); }
        await changePassword(username, pw);
        console.log(`Passwort für "${username}" wurde geändert.`);
        break;
      }

      case 'list': {
        const users = await listUsers();
        if (users.length === 0) {
          console.log('Keine Benutzer vorhanden.');
        } else {
          console.log('Benutzer:');
          for (const u of users) console.log(`  - ${u}`);
        }
        break;
      }

      default:
        console.error(`Unbekannter Befehl: "${command}"`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Fehler: ${err.message}`);
    process.exit(1);
  }
}

run();
