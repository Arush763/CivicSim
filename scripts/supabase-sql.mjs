#!/usr/bin/env node
// Builds supabase/setup.sql: every migration in supabase/migrations, in order, as one file to
// paste into the Supabase SQL editor. Run after adding or changing a migration:
//   node scripts/supabase-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const out = fileURLToPath(new URL('../supabase/setup.sql', import.meta.url));

export function buildSetupSql() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const parts = files.map((f) => `-- ================================================================ ${f}\n\n${readFileSync(dir + f, 'utf8').trim()}\n`);
  return [
    '-- Mamdani AI: the whole Supabase database in one file.',
    '-- Paste it into Supabase > SQL Editor > New query, and Run (on a new, empty project).',
    '-- Generated from supabase/migrations by scripts/supabase-sql.mjs; edit the migrations, not this file.',
    '',
    ...parts,
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(out, buildSetupSql());
  console.log(`wrote ${out}`);
}
