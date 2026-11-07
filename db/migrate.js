// Applies db/05_reviews.sql to the database in DATABASE_URL. Keeps all existing data.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '05_reviews.sql');
await pool.query(fs.readFileSync(file, 'utf8'));
const n = await pool.query('SELECT count(*)::int AS n FROM reviews');
console.log('Migration done. reviews table ready, rows:', n.rows[0].n);
await pool.end();
