-- Abastecimento apagado no app fica no painel por 30 dias, marcado como removido, e depois sai de vez.
ALTER TABLE fuel_ups ADD COLUMN removed_at timestamptz;
CREATE INDEX fuel_ups_removed_idx ON fuel_ups (removed_at) WHERE removed_at IS NOT NULL;
