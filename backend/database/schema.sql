-- ============================================================
-- Freelance Marketplace — TiDB / MySQL-compatible Schema (v1 / MVP)
-- ============================================================
-- Key differences from the Postgres version this replaces:
--   - No CREATE TYPE ... AS ENUM — enums are declared inline per column
--   - IDs are CHAR(36) UUIDs generated in the application (Node), not
--     gen_random_uuid() — MySQL/TiDB don't allow non-deterministic
--     functions as column defaults
--   - TIMESTAMPTZ -> DATETIME (TiDB/MySQL don't have a native tz-aware type)
--   - JSONB -> JSON
--   - Foreign keys use explicit `FOREIGN KEY (col) REFERENCES ...` —
--     MySQL parses inline column-level REFERENCES but does NOT enforce it
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Users & profiles
-- ------------------------------------------------------------
CREATE TABLE users (
    id                  CHAR(36) PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                ENUM('client', 'freelancer', 'admin') NOT NULL,
    full_name           VARCHAR(150) NOT NULL,
    country             VARCHAR(100),
    phone               VARCHAR(30),
    profile_photo_url   TEXT,
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    email_verify_token  VARCHAR(255),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_premium          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE freelancer_profiles (
    user_id             CHAR(36) PRIMARY KEY,
    headline            VARCHAR(200),
    bio                 TEXT,
    pricing_type        ENUM('hourly', 'fixed') NOT NULL DEFAULT 'fixed',
    hourly_rate         DECIMAL(10,2),
    experience_years    SMALLINT,
    id_document_url     TEXT,
    kyc_verified_at     DATETIME,
    available_balance   DECIMAL(12,2) NOT NULL DEFAULT 0,
    rating_avg          DECIMAL(3,2) DEFAULT 0,
    rating_count        INT DEFAULT 0,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE skills (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE freelancer_skills (
    freelancer_id   CHAR(36) NOT NULL,
    skill_id        INT NOT NULL,
    PRIMARY KEY (freelancer_id, skill_id),
    FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE portfolio_items (
    id              CHAR(36) PRIMARY KEY,
    freelancer_id   CHAR(36) NOT NULL,
    title           VARCHAR(200),
    description     TEXT,
    file_url        TEXT,
    external_link   TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Categories & Jobs
-- ------------------------------------------------------------
CREATE TABLE categories (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(100) UNIQUE NOT NULL,
    commission_rate     DECIMAL(4,2) NOT NULL DEFAULT 15.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE jobs (
    id                  CHAR(36) PRIMARY KEY,
    client_id           CHAR(36) NOT NULL,
    category_id         INT,
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    budget_min          DECIMAL(12,2),
    budget_max          DECIMAL(12,2),
    pricing_type        ENUM('hourly', 'fixed') NOT NULL DEFAULT 'fixed',
    deadline            DATE,
    status              ENUM('open', 'in_progress', 'submitted', 'completed', 'disputed', 'cancelled') NOT NULL DEFAULT 'open',
    is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
    featured_until      DATETIME,
    hired_freelancer_id CHAR(36),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (hired_freelancer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE job_skills (
    job_id      CHAR(36) NOT NULL,
    skill_id    INT NOT NULL,
    PRIMARY KEY (job_id, skill_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_category ON jobs(category_id);

-- ------------------------------------------------------------
-- Proposals
-- ------------------------------------------------------------
CREATE TABLE proposals (
    id              CHAR(36) PRIMARY KEY,
    job_id          CHAR(36) NOT NULL,
    freelancer_id   CHAR(36) NOT NULL,
    cover_letter    TEXT NOT NULL,
    bid_amount      DECIMAL(12,2) NOT NULL,
    estimated_days  INT,
    status          ENUM('pending', 'accepted', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, freelancer_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Messaging
-- ------------------------------------------------------------
CREATE TABLE message_threads (
    id              CHAR(36) PRIMARY KEY,
    job_id          CHAR(36),
    client_id       CHAR(36),
    freelancer_id   CHAR(36),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, client_id, freelancer_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id),
    FOREIGN KEY (freelancer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE messages (
    id              CHAR(36) PRIMARY KEY,
    thread_id       CHAR(36) NOT NULL,
    sender_id       CHAR(36) NOT NULL,
    body            TEXT NOT NULL,
    attachment_url  TEXT,
    read_at         DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES message_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Payments & Escrow
-- ------------------------------------------------------------
CREATE TABLE payments (
    id                  CHAR(36) PRIMARY KEY,
    job_id              CHAR(36) NOT NULL,
    client_id           CHAR(36) NOT NULL,
    freelancer_id       CHAR(36) NOT NULL,
    amount              DECIMAL(12,2) NOT NULL,
    commission_amount   DECIMAL(12,2) NOT NULL,
    freelancer_payout   DECIMAL(12,2) NOT NULL,
    provider            VARCHAR(30) NOT NULL,
    provider_ref        VARCHAR(255),
    status              ENUM('pending', 'held', 'released', 'refunded', 'partially_released') NOT NULL DEFAULT 'pending',
    held_at             DATETIME,
    released_at         DATETIME,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES users(id),
    FOREIGN KEY (freelancer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE withdrawals (
    id              CHAR(36) PRIMARY KEY,
    freelancer_id   CHAR(36) NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    provider        VARCHAR(30) NOT NULL,
    destination     VARCHAR(255) NOT NULL,
    status          ENUM('requested', 'processing', 'paid', 'failed') NOT NULL DEFAULT 'requested',
    requested_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at    DATETIME,
    FOREIGN KEY (freelancer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE disputes (
    id              CHAR(36) PRIMARY KEY,
    job_id          CHAR(36) NOT NULL,
    payment_id      CHAR(36),
    raised_by       CHAR(36) NOT NULL,
    reason          TEXT NOT NULL,
    status          ENUM('open', 'under_review', 'resolved') NOT NULL DEFAULT 'open',
    resolution_note TEXT,
    resolved_by     CHAR(36),
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     DATETIME,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payments(id),
    FOREIGN KEY (raised_by) REFERENCES users(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Reviews
-- ------------------------------------------------------------
CREATE TABLE reviews (
    id              CHAR(36) PRIMARY KEY,
    job_id          CHAR(36) NOT NULL,
    reviewer_id     CHAR(36) NOT NULL,
    reviewee_id     CHAR(36) NOT NULL,
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, reviewer_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id),
    FOREIGN KEY (reviewee_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Subscriptions
-- ------------------------------------------------------------
CREATE TABLE subscription_plans (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    target_role     ENUM('client', 'freelancer', 'admin') NOT NULL,
    monthly_price   DECIMAL(10,2) NOT NULL,
    perks           JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_subscriptions (
    id              CHAR(36) PRIMARY KEY,
    user_id         CHAR(36) NOT NULL,
    plan_id         INT NOT NULL,
    started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      DATETIME,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Seed: starter categories
-- ------------------------------------------------------------
INSERT INTO categories (name, commission_rate) VALUES
    ('Web Development', 15.00),
    ('Graphic Design', 15.00),
    ('Video Editing', 15.00),
    ('Writing', 15.00);
