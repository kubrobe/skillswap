# Defense guide: be ready for your professor's questions

The professor will check that **you** understand the project. Code you cannot explain is a risk, so use this guide for real study, not to memorize answers. Do the "Prove it yourself" tasks first.

## Prove it yourself (do these before the defense, without AI)

1. Redraw the ERD in pgAdmin (right-click database → ERD For Database). Be able to point to every PK, FK and the many-to-many.
2. Open pgAdmin Query Tool and write 5 queries yourself on this database: members by city; count of offers per skill; skills nobody offers (`LEFT JOIN ... WHERE ... IS NULL`); a mutual match for one user; exchanges with their status log.
3. Make 3 real changes and run the tests: (a) add a column `languages` to `profiles` and show it on the profile page; (b) add a new category and skill; (c) add the index experiment from the guide (`EXPLAIN ANALYZE` before and after `CREATE INDEX`).
4. Break something on purpose (e.g. remove a `WHERE user_id = $2`), see what happens, and fix it.

## Questions you should expect, and the idea behind the answer

**Database**
- *Why these tables?* Each real-world thing has its own table (user, profile, skill, exchange). Repeating data (skill names, categories) lives once and is referenced by id.
- *Where is the many-to-many?* A user can teach many skills, a skill can be taught by many users → junction table `user_offers` (and `user_requests` for wants). Open `db/01_schema.sql`.
- *Is it normalized? Which form?* 3NF: no repeating groups, every column depends on its table's key, no column depends on another non-key column. Example of what we avoided: storing the skill name inside `exchanges`.
- *Why is `users` separate from `profiles`?* Login data and public data change for different reasons and have different privacy.
- *What constraints protect the data?* PRIMARY KEY, FOREIGN KEY, UNIQUE (email; one offer per user+skill), CHECK (status values, level, no self-exchange), NOT NULL, partial unique index (no duplicate pending request).
- *Why is there an `exchange_status_log` table?* So history is not lost when `status` is overwritten.
- *What is an index and which did you add?* A lookup structure (like a book index). `idx_offers_skill` speeds the matching joins. The primary keys and UNIQUE constraints create indexes automatically.

**Transactions**
- *What is a transaction?* A group of statements that succeeds or fails as one (ACID).
- *Where do you use one and why?* Creating/changing an exchange must also write the history row. If one step fails, ROLLBACK leaves nothing half-done. Show `withTransaction` in `src/db.js`.
- *What does `FOR UPDATE` do?* Locks the row so two people cannot change the same exchange at the same moment.

**Security**
- *How are passwords stored?* Only a bcrypt hash (slow, salted). Show a row in `users`.
- *What is SQL injection and how do you prevent it?* User text breaking out of a query. We always use parameters (`$1, $2`), never string concatenation. The test sends `'; DROP TABLE users; --` and nothing happens.
- *What is XSS?* Injecting HTML/JS through text. The front end builds elements with `textContent` (helper `h()` in `public/app.js`), so text is never run as HTML.
- *How does login work?* Server makes a random token, stores its hash in `sessions`, sends the token in an httpOnly cookie. Each request looks up the hash.
- *Why the same error for wrong email and wrong password?* So attackers cannot discover which emails exist.

**Application**
- *How does matching work?* Two CTEs in `GET /api/matches`: people who offer what I want, people who want what I offer. A person in both = fair swap, sorted first.
- *Walk me through "send a swap request".* `member.js` form → `POST /api/exchanges` → validation → transaction (does provider teach it? do I teach mine? insert + log) → 201.
- *Why validate on the server if the browser already checks?* The browser check can be bypassed; the server is the real guard.
- *Why Express + PostgreSQL?* It is the guide's stack; Express routes are simple and PostgreSQL is a real relational database.

**Honesty questions**
- *What did you not finish?* Be ready to say: MongoDB part, 500k-row index test, deployment (see README table). Saying this clearly is better than being caught.
- *Who wrote this?* Say how you used AI. The guide asks you to understand and be able to explain every line.

## Files to read in this order (30–40 minutes)

1. `db/01_schema.sql` 2. `src/db.js` 3. `src/auth.js` 4. `src/validate.js` 5. `src/api.js` 6. `public/app.js` 7. one page script (`public/js/exchanges.js`) 8. `tests/api.test.js`
