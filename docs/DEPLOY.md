# Deploy SkillSwap (free): Supabase (PostgreSQL) + MongoDB Atlas (optional) + Render (website)

Status: **not deployed yet and not tested on these services.** Deployment needs accounts in YOUR name (GitHub, Supabase, Render, optionally Atlas), so you have to do these steps. Budget 45-60 minutes. Do it before the demo day, not on it.

## 0. Put the code on GitHub
1. Create a GitHub account/repository `skillswap` (public or private).
2. In the project folder (VS Code terminal):
   ```
   git init
   git add .
   git commit -m "SkillSwap: first version"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/skillswap.git
   git push -u origin main
   ```
3. Open the repository page and check that **`.env` and `node_modules` are NOT there** (`.gitignore` prevents it). Search the repo for the word "password": only the demo password `demo12345` and code should appear.
4. The guide's rubric asks for **meaningful commits on at least 3 different days**. Commit your own changes as you study and modify the project (`git commit -m "what you changed and why"`). Do not fake dates.

## 1. Database on Supabase
1. supabase.com → New project (choose a region near you, save the database password).
2. **Project Settings → Database → Connection string → "Connection pooling"** → copy it and replace `[YOUR-PASSWORD]`.
3. If the app later says `self-signed certificate in certificate chain`: Supabase → Database → **SSL Configuration → Download certificate**, open the file and paste ALL of its text into the `DB_SSL_CA` environment variable. (Do not turn certificate checking off.)
4. Load the tables and demo data into Supabase from your own computer:
   - Put the string into your local `.env` as `DATABASE_URL=...`
   - Run `npm run db:reset`, then `npm run db:bigdata` (generates the 500,000 rows; may take a minute).
   - Check in Supabase → **Table Editor** that tables and rows exist.
   - Remember to switch `.env` back to your local database when you want to work locally.
5. Supabase pauses free projects after 7 days without activity: open the dashboard the day before the demo.

## 2. MongoDB Atlas (only if the professor requires MongoDB)
1. mongodb.com/atlas → free M0 cluster → create a database user → Network Access: allow `0.0.0.0/0` for the demo.
2. Copy the connection string into `.env` as `MONGODB_URI=...`, run `npm run mongo:setup` (creates 2 collections, 12,000+ documents), then `npm run mongo:queries`.
3. Restart the server: the Insights page and reviews now use MongoDB.

## 3. Website on Render
1. render.com → New → **Web Service** → connect your GitHub repo.
2. Build command `npm install`, start command `npm start`, instance type Free (or let `render.yaml` fill it).
3. **Environment** tab: add `NODE_ENV=production`, `DATABASE_URL=<Supabase string>`, and (if used) `DB_SSL_CA`, `MONGODB_URI`.
4. Deploy. Watch the Logs until you see `SkillSwap running on ...`. Open the `.onrender.com` URL on your phone.
5. Free Render services sleep when idle: open the URL a few minutes before the demo so it is awake.

## Fallback if hosting fails on demo day
Run the site on your laptop (`npm start`) and share it with a temporary public link using a Cloudflare quick tunnel (see the guide, section on "Instant demo"), or just demo on localhost. Also record the 3-minute backup video the guide asks for.

## Test checklist (from the guide, tick it yourself)
- [ ] Open the public URL on a phone (mobile data, not Wi-Fi only)
- [ ] Sign up, add a skill you teach and one you want, see matches
- [ ] Search works; send a swap request; log in as the other member and accept it
- [ ] The new row is visible in Supabase Table Editor
- [ ] A failure case shows a friendly message (e.g. duplicate request, wrong password)
- [ ] No red errors in Chrome DevTools console (F12)
- [ ] No secrets in GitHub; README explains how to run
