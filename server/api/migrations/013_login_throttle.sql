-- Senhas erradas contadas por conta e por rede de origem (/24 ou /48): quem erra de um lugar só bloqueia
-- aquele lugar, e o dono continua entrando das redes que já usou. O contador da conta (users.failed_logins)
-- passa a valer só para redes desconhecidas, contra ataque espalhado por muitos endereços.
CREATE TABLE login_throttle (
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    net          text NOT NULL,
    failures     integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, net)
);
CREATE INDEX login_throttle_updated_idx ON login_throttle (updated_at);
