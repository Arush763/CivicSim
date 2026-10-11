#!/usr/bin/env node
// Check setup without printing environment variables, keys, profiles, or proposal contents.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../server/.env', import.meta.url)), quiet: true });
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure server/.env first');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let ready = true;
for (const table of ['proposals', 'proposal_feed', 'zone_scenes', 'request_drafts', 'cloud_jobs']) {
  const { error, status } = await client.from(table).select('*').limit(0);
  if (error) ready = false;
  console.log(`${table}: ${error ? `${status} ${error.message}` : 'ready'}`);
}
console.log(ready ? 'Cloud schema ready. Start the laptop server to process jobs.' : 'Apply the cloud setup migration to the existing CivicSim project.');
process.exitCode = ready ? 0 : 1;
