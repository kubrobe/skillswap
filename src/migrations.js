// Brings the database up to date every time the server starts.
// All files are idempotent (CREATE ... IF NOT EXISTS, ON CONFLICT DO NOTHING), so running them
// again on an up-to-date database changes nothing and never deletes data.
// This way the live Supabase database gets new tables simply by deploying - no manual step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
export const MIGRATIONS = ['05_reviews.sql', '06_collab.sql', '07_mobile.sql', '08_hackathon.sql', '09_sample_data.sql', '10_checkin.sql', '11_impact_history.sql'];

export async function applyMigrations() {
  for (const f of MIGRATIONS) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
}

/** true when the tables of the Android app exist (shown on /api/mobile/health). */
export async function mobileSchemaReady() {
  const r = await pool.query(
    `SELECT to_regclass('public.offer_slots') IS NOT NULL AND to_regclass('public.credit_ledger') IS NOT NULL AS ok`);
  return r.rows[0].ok;
}
