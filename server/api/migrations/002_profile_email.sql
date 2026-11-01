-- Perfil, foto e e-mail confirmado. Contas antigas seguem válidas, sem e-mail até a pessoa cadastrar.
ALTER TABLE users
    ADD COLUMN display_name text,
    ADD COLUMN email text UNIQUE CHECK (email = lower(email)),
    ADD COLUMN avatar bytea,
    ADD COLUMN avatar_updated_at timestamptz;

-- Troca pendente: o endereço só vale depois do link. Só o hash do token fica guardado.
CREATE TABLE email_changes (
    token_hash bytea PRIMARY KEY,
    user_id    uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    new_email  text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- Fila lida só pelo serviço mailer. A mensagem é apagada assim que é enviada.
CREATE TABLE mail_outbox (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient  text NOT NULL,
    subject    text NOT NULL,
    body       text NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    next_try   timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_outbox_next_idx ON mail_outbox (next_try);
