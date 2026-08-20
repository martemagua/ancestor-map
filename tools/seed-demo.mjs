#!/usr/bin/env node
// Command-line wrapper around the fictional demo family in
// server/demo-family.js — for development. On a running installation the
// same thing sits in /admin as a button, no shell required.
//
//   npm run seed                          # into ./data
//   DATA_DIR=/tmp/demo node tools/seed-demo.mjs
//
// Accounts are deliberately not created: a seeded install still walks you
// through the setup wizard.
import { seedDemoFamily } from '../server/demo-family.js';

try {
  const out = seedDemoFamily();
  console.log(`Seeded ${out.persons} fictional people, ${out.unions} unions, ${out.stories} stories.`);
} catch (err) {
  console.error(err.message === 'err.demo_not_empty'
    ? 'This tree already has people in it — the demo family only goes into an empty one.'
    : err.message);
  process.exit(1);
}
