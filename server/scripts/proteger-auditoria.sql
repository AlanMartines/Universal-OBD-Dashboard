-- Protege a auditoria do próprio papel da aplicação (quem invadisse a API não conseguiria apagar os rastros).
-- Rodar como DONO do banco (superusuário), depois que a API aplicou a migração 012. Pode rodar de novo.
-- O papel da aplicação é o dono do schema public (db/init): é ele que perde os direitos na auditoria.
DO $$
DECLARE
  app text := (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'public');
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rode como o dono do banco (superusuário), não como %', current_user;
  END IF;
  IF app = quote_ident(current_user) THEN
    RAISE EXCEPTION 'o schema public pertence a %, que é o próprio dono: não há papel da aplicação para restringir', app;
  END IF;
  IF to_regprocedure('audit_purge()') IS NULL THEN
    RAISE EXCEPTION 'falta a função audit_purge(): suba a API nova (migração 012) antes';
  END IF;
  -- a tabela (com a sequência do id) e a função de limpeza passam a ser do dono
  EXECUTE format('ALTER TABLE audit_log OWNER TO %I', current_user);
  EXECUTE format('ALTER FUNCTION audit_purge() OWNER TO %I', current_user);
  -- a aplicação só consulta e registra; apagar, alterar e esvaziar ficam de fora
  EXECUTE format('REVOKE ALL ON audit_log FROM %s', app);
  EXECUTE format('GRANT SELECT, INSERT ON audit_log TO %s', app);
  REVOKE ALL ON FUNCTION audit_purge() FROM PUBLIC;
  EXECUTE format('GRANT EXECUTE ON FUNCTION audit_purge() TO %s', app);
END $$;

-- O dono do schema pode apagar qualquer tabela dele: esta trava barra o DROP da auditoria para quem não é
-- superusuário (a manutenção do dono, como restaurar um backup, continua livre).
CREATE OR REPLACE FUNCTION protege_auditoria() RETURNS event_trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- roda com os direitos de quem fez o DROP (sem SECURITY DEFINER): é esse papel que se confere
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger_dropped_objects()
              WHERE object_type = 'table' AND object_identity = 'public.audit_log') THEN
    RAISE EXCEPTION 'a tabela audit_log é protegida e não pode ser apagada';
  END IF;
END $$;
REVOKE ALL ON FUNCTION protege_auditoria() FROM PUBLIC;
DROP EVENT TRIGGER IF EXISTS protege_auditoria;
CREATE EVENT TRIGGER protege_auditoria ON sql_drop EXECUTE FUNCTION protege_auditoria();
