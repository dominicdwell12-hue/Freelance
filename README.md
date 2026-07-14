# Freelance Marketplace — MVP

African-focused freelance marketplace (Upwork/Fiverr style): Web Dev, Graphic Design,
Video Editing, and Writing categories, with escrow payments.

**Stack:** Next.js frontend + Node.js/Express backend + TiDB Serverless (MySQL-compatible).

## What was in your upload vs. what I added

Your zip had scattered, mid-migration pieces (part Postgres, part TiDB, some files
referencing modules that didn't exist in the zip). I reorganized everything into a
real runnable project and converted every query to TiDB/MySQL syntax. Specifically:

**From your upload, converted Postgres → TiDB:** `auth.js`, `profiles.js`, `admin.js`,
`payments.js`, `withdrawals.js` (placeholders `$1→?`, `RETURNING`→follow-up `SELECT`,
`pool.connect()`→`pool.getConnection()` + `beginTransaction()`, Postgres `interval` math
→ `DATE_ADD`, `json_agg`→`JSON_ARRAYAGG`).

**From your upload, used as-is (already TiDB):** `proposals.js`, `config/db.js`,
`database/schema.sql`.

**Was missing entirely, so I wrote it:** `server.js`, `package.json` (both apps),
`middleware/auth.js`, `utils/token.js`, `utils/mailer.js` (stub), the three payment
provider adapters (`paystackProvider.js`, `flutterwaveProvider.js`, `stripeProvider.js`
— real API calls, but untested against live keys), `routes/jobs.js` (post/browse/edit/
cancel — referenced by the frontend and by proposals but never included), `lib/api.js`
(the frontend's API client — imported by your jobs page but not in the zip), root
`layout.js`/`page.js`, `render.yaml`, `.env.example` files.

**Not included anywhere (not in your zip, not reconstructed):** messaging, reviews,
public user profile pages, most frontend screens (login/register/dashboard/job detail/
post-a-job forms) — your own README mentioned these as "what's next." Only the jobs
browse page existed as a frontend screen.

## Local setup

**1. Database — TiDB Serverless**
1. Create a free cluster at [tidbcloud.com](https://tidbcloud.com)
2. Click **Connect** → Node.js tab → copy host/port/user/password
3. Run the schema:
   ```bash
   mysql -h <TIDB_HOST> -P 4000 -u <TIDB_USER> -p --ssl-mode=REQUIRED <TIDB_DATABASE> < backend/database/schema.sql
   ```
   (or paste it into the TiDB Cloud web SQL console)

**2. Backend**
```bash
cd backend
cp .env.example .env   # fill in TIDB_*, JWT secrets
npm install
npm run dev
```
Test: `curl http://localhost:4000/health`

**3. Frontend**
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Visit `http://localhost:3000`.

## Deploying: GitHub → Render → TiDB

1. **GitHub** — push this whole folder to a repo.
2. **TiDB Cloud** — same Serverless cluster as above (or a separate prod cluster;
   re-run `schema.sql` against it if separate).
3. **Render** — either click "New → Blueprint" and point it at your repo (it will
   read `render.yaml` and create both services), or set up manually:

   **Backend web service** — root dir `backend`, build `npm install`, start `npm start`,
   env vars from `backend/.env.example` with real values.

   **Frontend web service** — root dir `frontend`, build `npm install && npm run build`,
   start `npm start`, env var `NEXT_PUBLIC_API_URL` = your backend's Render URL.

   Free tier spins down after 15 min idle (30–60s cold start) — fine for testing.

4. **Payment webhooks** — once the backend has a public Render URL, point each
   provider's webhook config at `https://<backend>.onrender.com/payments/webhook/<provider>`.

## First admin account

No public admin signup route on purpose. Register a normal account, then:
```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Before real money moves through this

- Swap the Stripe webhook stub for real `stripe.webhooks.constructEvent` with a raw
  body parser on that route (flagged in `stripeProvider.js`).
- Add the missing frontend screens and messaging/reviews routes.
- Add automated tests around the escrow lifecycle (fund → hold → release/dispute).
