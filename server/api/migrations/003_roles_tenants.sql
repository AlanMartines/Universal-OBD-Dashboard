-- Três perfis: superadmin controla tudo; admin é dono de uma conta; user (atendimento) só visualiza a conta à qual está vinculado.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'admin';
UPDATE users SET role = CASE role WHEN 'admin' THEN 'superadmin' ELSE 'admin' END;
ALTER TABLE users ADD COLUMN account_id uuid REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin', 'admin', 'user'));
ALTER TABLE users ADD CONSTRAINT users_account_role_check CHECK ((role = 'user') = (account_id IS NOT NULL));
CREATE INDEX users_account_idx ON users (account_id);
