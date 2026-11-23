-- Mecânico: conta da oficina vinculada à conta do dono, só leitura, só os veículos liberados por ele,
-- nunca a localização, e com prazo opcional (access_until).
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin', 'admin', 'user', 'mechanic'));
ALTER TABLE users DROP CONSTRAINT users_account_role_check;
ALTER TABLE users ADD CONSTRAINT users_account_role_check CHECK ((role IN ('user', 'mechanic')) = (account_id IS NOT NULL));
ALTER TABLE users ADD COLUMN access_until timestamptz;
-- Mecânico criado por um link temporário: sem senha conhecida, fora da lista de usuários e sem "Meus Dados".
ALTER TABLE users ADD COLUMN via_link boolean NOT NULL DEFAULT false;

CREATE TABLE mechanic_devices (
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, device_id)
);
CREATE INDEX mechanic_devices_device_idx ON mechanic_devices (device_id);

-- Link temporário para a oficina: um veículo, só leitura, sem login e sem localização. Quem abre entra numa
-- sessão do mecânico oculto do link (user_id), com o mesmo prazo. Guarda só o hash do link.
CREATE TABLE share_links (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash   bytea NOT NULL UNIQUE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id    uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    label        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    uses         integer NOT NULL DEFAULT 0
);
CREATE INDEX share_links_device_idx ON share_links (device_id);
