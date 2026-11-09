// Loads the catalog, then FICTIONAL demo members so the site has data to show.
// All demo people are made up. Every demo account uses the password: demo12345
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (file) => pool.query(fs.readFileSync(path.join(here, file), 'utf8'));

await run('01_schema.sql');
await run('02_catalog.sql');

// [email, name, city, bio, offers[], wants[]]
const demo = [
  ['aziza@demo.uz',  'Aziza Karimova',  'Tashkent',  'Data student who loves teaching Python.', ['Python basics', 'Excel and data analysis', 'SQL and databases'], ['Korean for beginners', 'UI design in Figma']],
  ['bobur@demo.uz',  'Bobur Rakhimov',  'Samarkand', 'Front-end hobbyist. Happy to swap.',      ['Web development (HTML/CSS)', 'JavaScript', 'UI design in Figma'], ['Python basics', 'Guitar']],
  ['dilnoza@demo.uz','Dilnoza Yusupova','Tashkent',  'Designer, always learning new things.',   ['UI design in Figma', 'Photo editing'], ['SQL and databases', 'English conversation']],
  ['jasur@demo.uz',  'Jasur Tursunov',  'Bukhara',   'Guitar player and chess fan.',            ['Guitar', 'Chess'], ['Web development (HTML/CSS)', 'Public speaking']],
  ['malika@demo.uz', 'Malika Ergasheva','Khiva',     'English teacher in training.',            ['English conversation', 'IELTS writing'], ['Cooking plov', 'Photo editing']],
  ['sardor@demo.uz', 'Sardor Nazarov',  'Tashkent',  'Gym coach and public speaker.',           ['Gym training basics', 'Public speaking'], ['IELTS writing', 'Excel and data analysis']],
  ['nilufar@demo.uz','Nilufar Saidova', 'Fergana',   'Loves cooking and baking.',               ['Cooking plov', 'Baking'], ['Python basics', 'Russian']],
  ['timur@demo.uz',  'Timur Abdullaev', 'Tashkent',  'Backend dev, SQL nerd.',                  ['SQL and databases', 'JavaScript', 'Python basics'], ['Korean for beginners', 'Gym training basics']],
  ['kamola@demo.uz', 'Kamola Hasanova', 'Namangan',  'Korean learner turned tutor.',            ['Korean for beginners', 'Russian'], ['Python basics', 'SQL and databases']],
  ['rustam@demo.uz', 'Rustam Aliyev',   'Tashkent',  'Presentations and academic writing.',     ['Presentation design', 'Academic writing'], ['Guitar', 'Chess']],
];

const hash = await bcrypt.hash('demo12345', 10);
const skillId = async (name) =>
  (await pool.query('SELECT id FROM skills WHERE name = $1', [name])).rows[0].id;

for (const [i, [email, name, city, bio, offers, wants]] of demo.entries()) {
  // members joined on different days (oldest first) so growth queries have something to show
  const u = await pool.query("INSERT INTO users (email, password_hash, created_at) VALUES ($1,$2, now() - $3::int * interval '3 days') RETURNING id", [email, hash, (demo.length - i) * 3]);
  const id = u.rows[0].id;
  await pool.query('INSERT INTO profiles (user_id, display_name, city, bio) VALUES ($1,$2,$3,$4)', [id, name, city, bio]);
  // first skill = best one (advanced), last of three = newest (beginner), so the medal colours are all visible
  for (const [k, s] of offers.entries()) await pool.query('INSERT INTO user_offers (user_id, skill_id, level) VALUES ($1,$2,$3)',
    [id, await skillId(s), k === 0 ? 'advanced' : (k === 2 ? 'beginner' : 'intermediate')]);
  for (const s of wants)  await pool.query('INSERT INTO user_requests (user_id, skill_id) VALUES ($1,$2)', [id, await skillId(s)]);
}

// Two sample exchanges so the inbox is not empty
const uid = async (e) => (await pool.query('SELECT id FROM users WHERE email=$1', [e])).rows[0].id;
const ex = async (req, prov, wanted, offered, msg, status) => {
  const r = await pool.query(
    `INSERT INTO exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id, message, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [await uid(req), await uid(prov), await skillId(wanted), await skillId(offered), msg, status]);
  await pool.query('INSERT INTO exchange_status_log (exchange_id, status, changed_by) VALUES ($1,$2,$3)', [r.rows[0].id, 'pending', await uid(req)]);
};
await ex('bobur@demo.uz', 'aziza@demo.uz', 'Python basics', 'JavaScript', 'Hi Aziza, want to swap an hour each this week?', 'pending');
await ex('kamola@demo.uz', 'timur@demo.uz', 'SQL and databases', 'Korean for beginners', 'Korean for SQL?', 'pending');

// Three finished swaps with reviews, so profiles show ratings and the timeline has history to display.
const done = async (req, prov, wanted, offered, msg, reviews) => {
  const r = await pool.query(
    `INSERT INTO exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id, message, status, created_at)
     VALUES ($1,$2,$3,$4,$5,'completed', now() - interval '5 days') RETURNING id`,
    [await uid(req), await uid(prov), await skillId(wanted), await skillId(offered), msg]);
  const id = r.rows[0].id;
  for (const [st, who, ago] of [['pending', req, 5], ['accepted', prov, 4], ['completed', req, 2]]) {
    await pool.query("INSERT INTO exchange_status_log (exchange_id, status, changed_by, changed_at) VALUES ($1,$2,$3, now() - $4::int * interval '1 day')", [id, st, await uid(who), ago]);
  }
  for (const [by, about, rating, comment] of reviews) {
    await pool.query('INSERT INTO reviews (exchange_id, reviewer_id, reviewee_id, rating, comment) VALUES ($1,$2,$3,$4,$5)', [id, await uid(by), await uid(about), rating, comment]);
  }
};
await done('dilnoza@demo.uz', 'aziza@demo.uz', 'Python basics', 'UI design in Figma', 'Figma for Python?', [
  ['dilnoza@demo.uz', 'aziza@demo.uz', 5, 'Patient and clear. I wrote my first script in one hour.'],
  ['aziza@demo.uz', 'dilnoza@demo.uz', 4, 'Great Figma tips, a little rushed at the end.']]);
await done('jasur@demo.uz', 'bobur@demo.uz', 'JavaScript', 'Guitar', 'JavaScript for guitar lessons?', [
  ['jasur@demo.uz', 'bobur@demo.uz', 5, 'Explained everything with small examples.']]);
await done('malika@demo.uz', 'sardor@demo.uz', 'Public speaking', 'IELTS writing', 'Speaking tips for essay tips', [
  ['malika@demo.uz', 'sardor@demo.uz', 4, 'Useful feedback on my presentation.'],
  ['sardor@demo.uz', 'malika@demo.uz', 5, 'Very helpful essay structure advice.']]);

// A running swap (accepted) with chat, a learning workspace and milestones, so the new pages are not empty.
{
  const r = await pool.query(
    `INSERT INTO exchanges (requester_id, provider_id, skill_wanted_id, skill_offered_id, message, status, created_at)
     VALUES ($1,$2,$3,$4,'Python for plov?','accepted', now() - interval '2 days') RETURNING id`,
    [await uid('nilufar@demo.uz'), await uid('aziza@demo.uz'), await skillId('Python basics'), await skillId('Cooking plov')]);
  const id = r.rows[0].id;
  for (const [st, who, ago] of [['pending', 'nilufar@demo.uz', 2], ['accepted', 'aziza@demo.uz', 1]]) {
    await pool.query("INSERT INTO exchange_status_log (exchange_id, status, changed_by, changed_at) VALUES ($1,$2,$3, now() - $4::int * interval '1 day')", [id, st, await uid(who), ago]);
  }
  const say = async (who, text, minutesAgo, read) => pool.query(
    "INSERT INTO messages (exchange_id, sender_id, body, created_at, read_at) VALUES ($1,$2,$3, now() - $4::int * interval '1 minute', CASE WHEN $5 THEN now() END)", [id, await uid(who), text, minutesAgo, read]);
  await say('aziza@demo.uz', 'Hi Nilufar! Happy to start with Python basics. When are you free?', 300, true);
  await say('nilufar@demo.uz', 'Thank you! Evenings are best for me. And I will bring the plov recipe :)', 280, true);
  await say('aziza@demo.uz', 'Perfect. Let us start with variables and loops this week.', 120, true);
  await say('nilufar@demo.uz', 'Great, I installed Python already!', 15, false);
  await pool.query("INSERT INTO workspaces (exchange_id, objective, notes, updated_by) VALUES ($1,$2,$3,$4)",
    [id, 'Write a small Python program that stores plov recipes.', 'Week 1: variables and loops. Week 2: lists and a mini project.', await uid('aziza@demo.uz')]);
  let pos = 0;
  for (const [title, st] of [['Python fundamentals', 'done'], ['Functions and loops', 'doing'], ['Build a mini project', 'todo']]) {
    await pool.query('INSERT INTO milestones (exchange_id, title, status, position, created_by) VALUES ($1,$2,$3,$4,$5)', [id, title, st, ++pos, await uid('aziza@demo.uz')]);
  }
  const note = async (who, type, body, link, read) => pool.query('INSERT INTO notifications (user_id, type, body, link, read_at, created_at) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN now() END, now() - interval \'1 hour\' * random() * 5)', [await uid(who), type, body, link, read]);
  await note('aziza@demo.uz', 'request', 'Bobur Rakhimov wants to swap skills with you', '/exchanges', false);
  await note('aziza@demo.uz', 'message', 'New message from Nilufar Saidova', `/chat?id=${id}`, false);
  await note('aziza@demo.uz', 'review', 'Dilnoza Yusupova left you a 5-star review', `/member?id=${await uid('aziza@demo.uz')}`, true);
  await note('nilufar@demo.uz', 'milestone', 'Aziza Karimova marked "Python fundamentals" as done', `/workspace?id=${id}`, false);
}
// Weekly availability (0 = Monday). Local times in each member's own time zone.
for (const [email, slots] of [
  ['aziza@demo.uz', [[0, '18:00', '20:00'], [2, '18:00', '20:00'], [5, '10:00', '13:00']]],
  ['nilufar@demo.uz', [[0, '19:00', '21:00'], [4, '17:00', '19:00'], [5, '11:00', '14:00']]],
  ['bobur@demo.uz', [[1, '17:00', '19:00'], [2, '19:00', '21:00']]],
  ['timur@demo.uz', [[3, '20:00', '22:00'], [6, '12:00', '15:00']]],
]) for (const [d, a, b] of slots) await pool.query('INSERT INTO availability (user_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [await uid(email), d, a, b]);

// Tables of the Android app (time slots, bookings, reviews) + their demo data
await run('07_mobile.sql');
await run('08_hackathon.sql');

const counts = await pool.query(`SELECT
  (SELECT count(*) FROM users) users, (SELECT count(*) FROM skills) skills,
  (SELECT count(*) FROM user_offers) offers, (SELECT count(*) FROM user_requests) requests,
  (SELECT count(*) FROM exchanges) exchanges, (SELECT count(*) FROM reviews) reviews`);
console.log('Database ready:', counts.rows[0]);
await pool.end();
