// Runs the 500,000-row experiment from 04_big_data.sql and prints REAL measured timings.
//   npm run db:bigdata
// Results are also saved to docs/big_data_results.json for the report.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPEATS = 5;

const QUERIES = {
  'Q1 count one skill, last 7 days': `SELECT count(*) FROM search_log WHERE skill_id = 3 AND searched_at >= now() - interval '7 days'`,
  'Q2 top searched skills, last 7 days': `SELECT skill_id, count(*) FROM search_log WHERE searched_at >= now() - interval '7 days' AND skill_id IS NOT NULL GROUP BY skill_id ORDER BY 2 DESC LIMIT 8`,
  'Q3 one skill, one day': `SELECT count(*) FROM search_log WHERE skill_id = 3 AND searched_at >= now() - interval '2 days' AND searched_at < now() - interval '1 day'`,
};

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function explain(sql) {
  const r = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  const plan = r.rows[0]['QUERY PLAN'][0];
  const nodes = [];
  (function walk(n) { nodes.push(n['Node Type']); (n.Plans || []).forEach(walk); })(plan.Plan);
  return { ms: plan['Execution Time'], nodes: nodes.join(' > ') };
}

async function measure(label) {
  const out = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    await pool.query(sql);                       // warm-up run, not counted
    const runs = [];
    let nodes = '';
    for (let i = 0; i < REPEATS; i++) { const e = await explain(sql); runs.push(e.ms); nodes = e.nodes; }
    out[name] = { median_ms: +median(runs).toFixed(2), runs_ms: runs.map((x) => +x.toFixed(2)), plan: nodes };
    console.log(`${label.padEnd(7)} ${name.padEnd(38)} median ${out[name].median_ms} ms   [${nodes}]`);
  }
  return out;
}

// Generate the data (same statement as 04_big_data.sql)
const t0 = Date.now();
await pool.query('TRUNCATE search_log RESTART IDENTITY');
await pool.query('DROP INDEX IF EXISTS idx_search_skill_time');
const sqlText = fs.readFileSync(path.join(here, '04_big_data.sql'), 'utf8');
const insert = sqlText.slice(sqlText.indexOf('WITH u AS'), sqlText.indexOf('ANALYZE search_log;'));
await pool.query(insert);
await pool.query('ANALYZE search_log');
const rows = (await pool.query('SELECT count(*)::int n FROM search_log')).rows[0].n;
console.log(`Generated ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const before = await measure('BEFORE');
await pool.query('CREATE INDEX idx_search_skill_time ON search_log (skill_id, searched_at)');
await pool.query('ANALYZE search_log');
const after = await measure('AFTER');

// Cost of the index on writes: insert 100,000 rows into two identical scratch tables
await pool.query('DROP TABLE IF EXISTS tmp_plain, tmp_indexed');
await pool.query('CREATE TABLE tmp_plain (LIKE search_log INCLUDING DEFAULTS)');
await pool.query('CREATE TABLE tmp_indexed (LIKE search_log INCLUDING DEFAULTS)');
await pool.query('CREATE INDEX ON tmp_indexed (skill_id, searched_at)');
const bulk = (t) => `INSERT INTO ${t} (user_id, skill_id, term, device, searched_at) SELECT 1, 1 + (g % 23), 'x', 'mobile', now() - (g || ' seconds')::interval FROM generate_series(1, 100000) g`;
let s = Date.now(); await pool.query(bulk('tmp_plain'));   const plainMs = Date.now() - s;
s = Date.now();     await pool.query(bulk('tmp_indexed')); const indexedMs = Date.now() - s;
await pool.query('DROP TABLE tmp_plain, tmp_indexed');

const sizes = (await pool.query(`SELECT pg_size_pretty(pg_relation_size('search_log')) t, pg_size_pretty(pg_relation_size('idx_search_skill_time')) i`)).rows[0];
const result = {
  measured_at: new Date().toISOString(), rows, repeats_per_query: REPEATS,
  before, after,
  insert_100k_ms: { without_index: plainMs, with_index: indexedMs },
  sizes: { table: sizes.t, index: sizes.i },
};
fs.writeFileSync(path.join(here, '..', 'docs', 'big_data_results.json'), JSON.stringify(result, null, 2));
console.log(`Insert 100,000 rows: ${plainMs} ms without index, ${indexedMs} ms with index.  Table ${sizes.t}, index ${sizes.i}`);
await pool.end();
