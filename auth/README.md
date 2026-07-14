# Freelance Marketplace — MVP Starter

African-focused freelance marketplace (Upwork/Fiverr style), starting with Web Dev, Graphic Design,
Video Editing, and Writing categories.

## What's in this scaffold

- `docs/ARCHITECTURE.md` — full system design, escrow lifecycle, build order
- `database/schema.sql` — complete PostgreSQL schema (users, jobs, proposals, escrow, disputes, reviews, subscriptions)
- `backend/` — working Node.js/Express API with:
  - User registration (client + freelancer) with bcrypt password hashing
  - Email verification token flow (email sending is stubbed — wire up `nodemailer` in `src/utils/mailer.js`)
  - JWT login with access + refresh tokens
  - Protected profile routes (`GET /profiles/me`, `PATCH /profiles/freelancer`)
  - Middleware for auth + role-based access control

## Getting started

```bash
# 1. Create the database
createdb freelance_marketplace
psql freelance_marketplace < database/schema.sql

# 2. Configure the backend
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL and JWT secrets

# 3. Install & run
npm install
npm run dev   # requires nodemon; or `npm start`
```

API will be live at `http://localhost:4000`. Test it:

```bash
curl http://localhost:4000/health

curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","full_name":"Test User","role":"freelancer"}'
```

## What's next (in build order)

1. **Jobs API** — CRUD for job postings + search/filter by category/skill
2. **Proposals API** — submit bid, client compares, hire action (locks job + creates escrow payment record)
3. **Payments/Escrow** — Paystack/Flutterwave sandbox integration, webhook handling for fund confirmation
4. **Messaging** — thread creation tied to job+proposal, simple polling or WebSocket (Socket.io) for real-time
5. **Reviews** — enforce "completed job + matching payment" constraint from the schema
6. **Admin dashboard** — dispute resolution, user moderation, category commission config
7. **Frontend (Next.js)** — auth pages, job browse/post, freelancer profile pages, dashboard

Each of these can be built the same way this scaffold was: schema piece already exists in
`database/schema.sql`, so it's mostly route handlers + validation following the `auth.js`/`profiles.js` pattern.

## Notes on trust & safety (don't skip these)

- Reviews should be blocked unless there's a `completed` job + matching `released` payment — already enforced at the schema level via the unique constraint, but add an application-level check too.
- Freelancers need KYC (`id_document_url`, `kyc_verified_at`) verified before their first withdrawal — the field exists in `freelancer_profiles`, but the withdrawal route needs to check it.
- Disputes should never silently auto-resolve — always require an admin action logged in the `disputes` table.
