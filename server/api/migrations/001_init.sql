-- Esquema inicial. O servidor só recebe e mostra dados: nenhuma tabela guarda comandos para o carro.

CREATE TABLE users (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username             text NOT NULL UNIQUE CHECK (username = lower(username)),
    password_hash        text NOT NULL,
    role                 text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    must_change_password boolean NOT NULL DEFAULT false,
    disabled             boolean NOT NULL DEFAULT false,
    failed_logins        integer NOT NULL DEFAULT 0,
    locked_until         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- Só o hash do token fica no banco: um vazamento não permite sequestrar sessões.
CREATE TABLE sessions (
    token_hash   bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    csrf_token   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE devices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               text NOT NULL,
    installation_id    uuid,
    token_hash         bytea UNIQUE,
    pairing_code_hash  bytea UNIQUE,
    pairing_expires_at timestamptz,
    app_version        text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    paired_at          timestamptz,
    last_seen_at       timestamptz,
    revoked_at         timestamptz
);
CREATE INDEX devices_user_idx ON devices (user_id);

-- (device_id, seq) torna o envio idempotente: repetir um pacote não duplica dados.
CREATE TABLE telemetry_samples (
    device_id   uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    seq         bigint NOT NULL,
    ts          timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    trip_id     bigint,
    metrics     jsonb NOT NULL,
    dtcs        text[] NOT NULL DEFAULT '{}',
    latitude    double precision,
    longitude   double precision,
    gps_speed   double precision,
    gps_accuracy double precision,
    PRIMARY KEY (device_id, seq)
);
CREATE INDEX telemetry_device_ts_idx ON telemetry_samples (device_id, ts DESC);
CREATE INDEX telemetry_ts_idx ON telemetry_samples (ts);

-- Trilha de auditoria: nunca grava senhas nem tokens.
CREATE TABLE audit_log (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at       timestamptz NOT NULL DEFAULT now(),
    actor    text,
    action   text NOT NULL,
    target   text,
    ip       text
);
CREATE INDEX audit_at_idx ON audit_log (at DESC);
