# Freelance Marketplace — Architecture & MVP Spec

## Niche (v1)
African freelancers serving African & global clients, starting with 4 categories:
Web Development, Graphic Design, Video Editing, Writing.
Expansion categories (v2+): Accounting, Electrical/Solar, Tutoring, Virtual Assistants, Translation, Marketing.

## Stack
- **Frontend:** Next.js (React) + Tailwind CSS
- **Backend:** Node.js + Express (REST API)
- **Database:** PostgreSQL
- **Auth:** JWT (access + refresh tokens), bcrypt for password hashing
- **File storage:** AWS S3 or Cloudinary (portfolio images, profile photos, attachments)
- **Payments:** Paystack / Flutterwave (primary, African rails) + Stripe (international clients)
- **Email:** Resend or SendGrid (verification, notifications)

## High-level system diagram

```
                 ┌─────────────────┐
                 │   Next.js Web   │
                 │   (Frontend)    │
                 └────────┬────────┘
                          │ HTTPS / REST
                 ┌────────▼────────┐
                 │  Express API    │
                 │  (Backend)      │
                 ├─────────────────┤
                 │ Auth Middleware │
                 │ Rate Limiting   │
                 └───┬─────────┬───┘
                     │         │
         ┌───────────▼──┐   ┌──▼────────────┐
         │  PostgreSQL  │   │  S3/Cloudinary │
         │  (core data) │   │  (files)       │
         └──────────────┘   └────────────────┘
                     │
         ┌───────────▼───────────┐
         │ Paystack/Flutterwave/ │
         │ Stripe (escrow, payout)│
         └────────────────────────┘
```

## Core modules (API)
1. **Auth** — register, login, email verification, refresh tokens, password reset
2. **Users/Profiles** — freelancer & client profiles, skills, portfolio, rates
3. **Jobs** — CRUD for job postings, skill tagging, search/filter
4. **Proposals** — freelancer bids, client comparison, hire action
5. **Messaging** — client↔freelancer threads (tied to a job/proposal)
6. **Escrow/Payments** — fund escrow on hire, release on approval, commission cut, withdrawal requests
7. **Reviews** — star ratings + text, tied to completed jobs only (prevents fake reviews)
8. **Admin** — dispute resolution, user moderation, commission config, featured job approval

## Data flow: escrow lifecycle (critical path)
1. Client hires freelancer → proposal status = `accepted`, job status = `in_progress`
2. Client funds escrow via Paystack/Flutterwave/Stripe → payment status = `held`
3. Freelancer delivers work → job status = `submitted`
4. Client approves → escrow released: platform commission deducted, remainder credited to freelancer's withdrawable balance → payment status = `released`
5. If client disputes instead of approving → job status = `disputed`, admin resolves manually (split, refund, or release)
6. Freelancer requests withdrawal → payout processed via provider, withdrawal status tracked separately from escrow

## Anti-fraud / trust notes (gap in original plan, addressed here)
- Reviews are only writable on `completed` jobs with a matching payment record — prevents review spam.
- Freelancer payouts require KYC fields (id_document_url, verified_at) before first withdrawal — added to schema.
- Disputes get a dedicated table/state rather than being crammed into job status — needed once volume grows.

## Commission model (v1)
- Flat 15% commission on completed projects (adjustable per category later via `commission_rate` on categories table)
- Featured job flag: flat fee, no recurring logic needed for MVP
- Premium freelancer: subscription table reused for both client and freelancer premium tiers

## Build order (recommended)
1. Database schema (this deliverable)
2. Auth (register/login/verify/JWT)
3. Profile CRUD (client + freelancer)
4. Job posting + browse/search
5. Proposals + hire flow
6. Escrow payment integration (sandbox mode first)
7. Messaging
8. Reviews
9. Admin dashboard + dispute handling
10. Featured jobs / premium / subscriptions monetization layer
