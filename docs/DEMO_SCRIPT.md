# 7-minute demo script

Practise this out loud 2-3 times. The same notes are in the slide speaker notes.

| Time | Slide | Say / do |
|---|---|---|
| 0:00 | Cover | Name, one sentence: trade a skill you can teach for one you want to learn. |
| 0:15 | Idea | Problem: lessons cost money. Idea: swaps, no money. Demo data is fictional. |
| 0:45 | Architecture | Browser -> Express API -> PostgreSQL. MongoDB optional, not tested on a real server. |
| 1:30 | ERD | users, skills, link tables (many-to-many), exchanges, status log. |
| 2:15 | Live site | 360px phone view. Log in (demo12345), matches, browse, send request, switch user, accept. |
| 3:45 | Transaction | Run db/03_queries.sql Q18 in psql. Explain the intended failure and ROLLBACK. |
| 4:45 | Big data | 500k rows. Q1 22.1 -> 1.88 ms, Q3 22.62 -> 0.31 ms, Q2 no gain, inserts slower. |
| 5:45 | Code | Explain fair matching (Q19 / /api/matches) in your own words. |
| 6:30 | Status | Honest limits, roadmap. |
| 7:00 | Thanks | Questions. See DEFENSE_GUIDE.md. |

Before presenting: reset data (`npm run db:reset`), have the 3-minute backup video ready, fill the [BRACKETS] in the slides.
