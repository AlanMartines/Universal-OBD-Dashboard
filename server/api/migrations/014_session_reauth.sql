-- Confirmação recente da senha (modo "confirme sua senha"): ações críticas exigem que ela tenha sido
-- digitada nos últimos minutos nesta sessão. O login conta como confirmação; o modo suporte não.
ALTER TABLE sessions ADD COLUMN reauth_at timestamptz;
