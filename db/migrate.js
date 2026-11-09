// Applies db/05_reviews.sql and db/06_collab.sql to the database in DATABASE_URL. Keeps all existing data.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['05_reviews.sql', '06_collab.sql', '07_mobile.sql', '08_hackathon.sql']) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
const n = await pool.query('SELECT count(*)::int AS n FROM reviews');
console.log('Migration done. reviews rows:', n.rows[0].n, '| new tables: messages, notifications, workspaces, milestones, availability, offer_slots, slot_bookings, slot_reviews, credit_ledger, lesson_plans');
await pool.end();
