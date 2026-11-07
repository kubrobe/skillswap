// One shared connection pool for the whole app.
import pg from 'pg';

// Hosted databases (Supabase, Render, Neon...) need an encrypted connection; a local one does not.
// Certificate checking stays ON. If your provider uses its own certificate authority, download its
// CA certificate and put the PEM text into the DB_SSL_CA environment variable.
const url = process.env.DATABASE_URL || 'postgres://skillswap:skillswap@localhost:5432/skillswap';
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : (process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : true),
});

// Run one query. ALWAYS pass user input in `params` ($1, $2...) - never glue it into the SQL text.
export const query = (text, params) => pool.query(text, params);

// Run several queries as ONE transaction: all succeed (COMMIT) or none do (ROLLBACK).
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
