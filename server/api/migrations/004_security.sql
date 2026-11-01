-- Dois fatores, sessões identificáveis, redefinição de senha e personificação.
ALTER TABLE users
    ADD COLUMN totp_secret text,
    ADD COLUMN totp_pending text,
    ADD COLUMN totp_enabled_at timestamptz,
    ADD COLUMN totp_last_step bigint;

CREATE TABLE recovery_codes (
    code_hash bytea PRIMARY KEY,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id);

CREATE TABLE mfa_challenges (
    token_hash bytea PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    attempts   integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
);

CREATE TABLE password_resets (
    token_hash bytea PRIMARY KEY,
    user_id    uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

ALTER TABLE sessions
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    ADD COLUMN ip text,
    ADD COLUMN user_agent text,
    ADD COLUMN impersonator_id uuid REFERENCES users (id) ON DELETE CASCADE;
