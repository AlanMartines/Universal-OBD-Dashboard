-- Limpeza da auditoria por função, para o papel da aplicação não precisar de DELETE na tabela.
-- Depois desta migração, scripts/proteger-auditoria.sh (rodado uma vez como dono do banco) passa a tabela
-- e esta função para o dono: a API fica só com SELECT e INSERT, e a função apaga só o que passou de 1 ano.
CREATE OR REPLACE FUNCTION audit_purge() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH apagados AS (DELETE FROM audit_log WHERE at < now() - interval '365 days' RETURNING 1)
  SELECT count(*) FROM apagados
$$;
