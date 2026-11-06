-- Último retrato do computador de bordo enviado pelo app ao vivo (autonomia, km/l desde o abastecimento…),
-- para o cartão do veículo na página inicial. Gravado no máximo uma vez por minuto.
ALTER TABLE devices
    ADD COLUMN computer jsonb,
    ADD COLUMN computer_at timestamptz;
