#!/usr/bin/env node
// The escape hatch for when you're locked out (there is no mailer yet).
//
//   docker exec -it ancestormap node server/reset-password.js
//   docker exec -it ancestormap node server/reset-password.js alex newPassword123
//
// Run on the machine itself, where being able to do this means you already
// own the box. English on purpose: this speaks to whoever administers the
// host, not to an app user in their chosen language.
import { db } from './db.js';
import { hashPassword, listUsers } from './auth.js';

const [, , username, password] = process.argv;

if (!username) {
  const users = listUsers();
  console.log(users.length ? 'Accounts:' : 'There are no accounts yet.');
  for (const u of users) console.log(`  ${u.username}  [${u.role}]  (created ${String(u.created_at).slice(0, 10)})`);
  console.log('\nUsage: node server/reset-password.js <username> <new-password>');
  process.exit(users.length ? 0 : 1);
}

if (!password || password.length < 8) {
  console.error('The new password needs at least 8 characters.');
  process.exit(1);
}

const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
if (!user) {
  console.error(`No account named "${username}".`);
  process.exit(1);
}

db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), user.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);

console.log(`Password for "${user.username}" set. All devices were signed out.`);
process.exit(0);
