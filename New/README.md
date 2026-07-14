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
  - Jobs API: post, browse/search (by category, skill, budget, keyword), view, edit, cancel
  - Proposals API: submit bid, client comparison view, hire flow (locks job + auto-rejects other
    proposals + creates a `pending` escrow payment record with commission pre-calculated)
  - **Payments/Escrow — provider-agnostic.** One common interface
    (`src/services/payments/provider.interface.js`) with three adapters already implemented:
    Paystack, Flutterwave, and Stripe. Routes don't know which provider is in play — they just
    call `getProvider(name)` and use the same methods. Covers: fund escrow (hosted checkout),
    webhook confirmation (signature-verified per provider), release to freelancer (with
    commission split), and basic dispute filing.
  - Withdrawals API: freelancer payout requests, gated by KYC verification, balance deducted
    atomically before the transfer attempt to avoid double-withdraw races
  - Messaging API: open a thread tied to a specific job (client or freelancer with an active
    proposal), send/list messages, unread counts, mark-as-read
  - Reviews API: rating + comment, but only accepted once a job is `completed` **and** its
    payment is `released` — checked at the application level, not just relying on the client
    to behave. Denormalizes the freelancer's `rating_avg`/`rating_count` on submit so profile
    lookups don't need to aggregate every review row on every page load.
  - **Admin API** — the backend is now feature-complete for the MVP. Covers: dispute queue +
    resolution (release/refund/split — the only place escrow funds move without either party's
    direct action), user suspend/reactivate, per-category commission rate config, and featured-job
    approval.

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

## API endpoints so far

```
POST   /auth/register
GET    /auth/verify-email?token=...
POST   /auth/login
POST   /auth/refresh

GET    /profiles/me
PATCH  /profiles/freelancer

POST   /jobs                          (client)
GET    /jobs?category_id=&skill_id=&q=&min_budget=&max_budget=&page=&limit=
GET    /jobs/:id
PATCH  /jobs/:id                      (client, own open job only)
POST   /jobs/:id/cancel               (client, own open job only)

POST   /jobs/:jobId/proposals         (freelancer bids)
GET    /jobs/:jobId/proposals         (client compares bids)
GET    /proposals/mine                (freelancer's own proposals)
POST   /proposals/:id/hire            (client accepts — locks job, creates pending escrow payment)
POST   /proposals/:id/withdraw        (freelancer withdraws a pending bid)

POST   /payments/:paymentId/fund      (client, body: {provider, currency}) -> checkout URL
POST   /payments/webhook/:provider    (public — provider calls this on charge success)
POST   /payments/:paymentId/release   (client approves work -> credits freelancer, completes job)
POST   /payments/:paymentId/dispute   (either party, only while payment is 'held')

POST   /withdrawals                   (freelancer, body: {amount, provider, destination})
GET    /withdrawals/mine

POST   /jobs/:jobId/threads           (open/fetch a message thread for a job)
GET    /messages/threads/mine         (conversation list with previews + unread counts)
GET    /messages/threads/:id/messages (paginated history; ?before=&limit=)
POST   /messages/threads/:id/messages (send a message)
POST   /messages/threads/:id/read     (mark other party's messages read)

POST   /jobs/:jobId/reviews           (rate the other party — only after completed + released)
GET    /users/:userId/reviews         (public reputation view)

GET    /admin/disputes?status=open    (admin)
POST   /admin/disputes/:id/resolve    (admin, body: {resolution, split_freelancer_amount?, resolution_note})
POST   /admin/users/:id/suspend       (admin)
POST   /admin/users/:id/reactivate    (admin)
PATCH  /admin/categories/:id          (admin, body: {commission_rate})
POST   /admin/jobs/:id/feature        (admin, body: {days?})
```

## Creating your first admin account

There's no public "sign up as admin" route on purpose — anyone hitting an open endpoint to grant
themselves admin would be a critical vulnerability. Instead, register a normal account, then
promote it directly in the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Payment provider setup

Each adapter needs its own API keys in `.env` (see `.env.example`):
- **Paystack**: `PAYSTACK_SECRET_KEY` — webhook signature checked via `x-paystack-signature` header
- **Flutterwave**: `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` (set the same hash string in
  your Flutterwave dashboard's webhook config) — checked via `verif-hash` header
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — the adapter includes a structural stand-in
  for signature verification; swap in the official `stripe` npm package's `stripe.webhooks.constructEvent`
  before going to production, since correct Stripe signature checking needs their exact HMAC scheme

To add a fourth provider later, drop a new file in `src/services/payments/` implementing the interface
documented in `provider.interface.js`, then register it in `services/payments/index.js`.

## What's next

The backend is feature-complete for the MVP. A working frontend shell now exists too
(`frontend/`, Next.js) — home, register, login, browse/search jobs, post a job, job detail
with proposal submission and hire flow, and a role-aware dashboard. All styling lives in
dedicated `.module.css` files (see `frontend/DESIGN_NOTES.md` for the design reasoning) —
no inline `style=` attributes and no `<style>` tags anywhere in the JSX.

Remaining:

1. **More frontend screens** — freelancer public profile pages, messaging inbox UI, escrow
   funding/release flow, withdrawal request form, admin dispute queue.
2. **Deployment** — pick a host (Render/Railway/Fly.io are simple for this stack), managed
   Postgres, environment secrets, and DNS. Not started yet.
3. **Testing** — no automated tests exist yet. Worth adding at least integration tests around
   the escrow lifecycle (fund → hold → release/dispute) before real money moves through it.
4. **Real Stripe webhook verification** — flagged earlier: swap the structural stand-in in
   `stripeProvider.js` for the official SDK's `stripe.webhooks.constructEvent` before production.

## Running the frontend

```bash
cd frontend
npm install
# create .env.local with: NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev
```

Visit `http://localhost:3000`. The backend must be running (see above) for pages to load data.

Each of these can be built the same way this scaffold was: schema piece already exists in
`database/schema.sql`, so it's mostly route handlers + validation following the `auth.js`/`profiles.js` pattern.

## Notes on trust & safety (don't skip these)

- Reviews should be blocked unless there's a `completed` job + matching `released` payment — already enforced at the schema level via the unique constraint, but add an application-level check too.
- Freelancers need KYC (`id_document_url`, `kyc_verified_at`) verified before their first withdrawal — the field exists in `freelancer_profiles`, but the withdrawal route needs to check it.
- Disputes should never silently auto-resolve — always require an admin action logged in the `disputes` table.
