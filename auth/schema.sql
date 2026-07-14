-- ============================================================
-- Freelance Marketplace — PostgreSQL Schema (v1 / MVP)
-- ============================================================

CREATE TYPE user_role AS ENUM ('client', 'freelancer', 'admin');
CREATE TYPE pricing_type AS ENUM ('hourly', 'fixed');
CREATE TYPE job_status AS ENUM ('open', 'in_progress', 'submitted', 'completed', 'disputed', 'cancelled');
CREATE TYPE proposal_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
CREATE TYPE payment_status AS ENUM ('pending', 'held', 'released', 'refunded', 'partially_released');
CREATE TYPE withdrawal_status AS ENUM ('requested', 'processing', 'paid', 'failed');
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved');

-- ------------------------------------------------------------
-- Users & profiles
-- ------------------------------------------------------------
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                user_role NOT NULL,
    full_name           VARCHAR(150) NOT NULL,
    country             VARCHAR(100),
    phone               VARCHAR(30),
    profile_photo_url   TEXT,
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    email_verify_token  VARCHAR(255),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_premium          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Freelancer-specific profile data
CREATE TABLE freelancer_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    headline            VARCHAR(200),
    bio                 TEXT,
    pricing_type        pricing_type NOT NULL DEFAULT 'fixed',
    hourly_rate         NUMERIC(10,2),
    experience_years    SMALLINT,
    id_document_url     TEXT,          -- KYC, required before first withdrawal
    kyc_verified_at     TIMESTAMPTZ,
    available_balance   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- withdrawable, post-commission
    rating_avg          NUMERIC(3,2) DEFAULT 0,
    rating_count        INT DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE skills (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(100)
);

CREATE TABLE freelancer_skills (
    freelancer_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    skill_id        INT REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (freelancer_id, skill_id)
);

CREATE TABLE portfolio_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200),
    description     TEXT,
    file_url        TEXT,
    external_link   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Categories & Jobs
-- ------------------------------------------------------------
CREATE TABLE categories (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(100) UNIQUE NOT NULL,
    commission_rate     NUMERIC(4,2) NOT NULL DEFAULT 15.00  -- percent
);

CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id     INT REFERENCES categories(id),
    title           VARCHAR(200) NOT NULL,
    description     TEXT NOT NULL,
    budget_min      NUMERIC(12,2),
    budget_max      NUMERIC(12,2),
    pricing_type    pricing_type NOT NULL DEFAULT 'fixed',
    deadline        DATE,
    status          job_status NOT NULL DEFAULT 'open',
    is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
    featured_until  TIMESTAMPTZ,
    hired_freelancer_id UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_skills (
    job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
    skill_id    INT REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, skill_id)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_category ON jobs(category_id);

-- ------------------------------------------------------------
-- Proposals
-- ------------------------------------------------------------
CREATE TABLE proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    freelancer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_letter    TEXT NOT NULL,
    bid_amount      NUMERIC(12,2) NOT NULL,
    estimated_days  INT,
    status          proposal_status NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, freelancer_id)
);

-- ------------------------------------------------------------
-- Messaging
-- ------------------------------------------------------------
CREATE TABLE message_threads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
    client_id   UUID REFERENCES users(id),
    freelancer_id UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, client_id, freelancer_id)
);

CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id   UUID NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    attachment_url TEXT,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Payments & Escrow
-- ------------------------------------------------------------
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    client_id           UUID NOT NULL REFERENCES users(id),
    freelancer_id       UUID NOT NULL REFERENCES users(id),
    amount              NUMERIC(12,2) NOT NULL,
    commission_amount   NUMERIC(12,2) NOT NULL,
    freelancer_payout   NUMERIC(12,2) NOT NULL,
    provider            VARCHAR(30) NOT NULL,  -- 'paystack' | 'flutterwave' | 'stripe'
    provider_ref        VARCHAR(255),
    status              payment_status NOT NULL DEFAULT 'pending',
    held_at             TIMESTAMPTZ,
    released_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id   UUID NOT NULL REFERENCES users(id),
    amount          NUMERIC(12,2) NOT NULL,
    provider        VARCHAR(30) NOT NULL,
    destination     VARCHAR(255) NOT NULL, -- bank/mobile money ref
    status          withdrawal_status NOT NULL DEFAULT 'requested',
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

CREATE TABLE disputes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    payment_id      UUID REFERENCES payments(id),
    raised_by       UUID NOT NULL REFERENCES users(id),
    reason          TEXT NOT NULL,
    status          dispute_status NOT NULL DEFAULT 'open',
    resolution_note TEXT,
    resolved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- Reviews (only for completed jobs w/ matching payment)
-- ------------------------------------------------------------
CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    reviewer_id     UUID NOT NULL REFERENCES users(id),
    reviewee_id     UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, reviewer_id)
);

-- ------------------------------------------------------------
-- Subscriptions (client "hire frequently" plans & freelancer premium)
-- ------------------------------------------------------------
CREATE TABLE subscription_plans (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    target_role     user_role NOT NULL,
    monthly_price   NUMERIC(10,2) NOT NULL,
    perks           JSONB
);

CREATE TABLE user_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id         INT NOT NULL REFERENCES subscription_plans(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Seed: starter categories
-- ------------------------------------------------------------
INSERT INTO categories (name, commission_rate) VALUES
    ('Web Development', 15.00),
    ('Graphic Design', 15.00),
    ('Video Editing', 15.00),
    ('Writing', 15.00);
