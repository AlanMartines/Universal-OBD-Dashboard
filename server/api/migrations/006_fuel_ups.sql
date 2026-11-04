-- Abastecimentos registrados no app, por dispositivo (um dispositivo por veículo).
-- O app manda a lista inteira do veículo: edições e exclusões feitas no celular chegam aqui.
-- Nome do posto e observações ficam só no celular.
CREATE TABLE fuel_ups (
    device_id       uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    local_id        bigint NOT NULL,
    ts              timestamptz NOT NULL,
    odometer_km     double precision,
    liters          double precision NOT NULL,
    total_price     double precision,
    price_per_liter double precision,
    fuel_type       text NOT NULL CHECK (fuel_type IN ('gasoline', 'gasoline_premium', 'ethanol', 'mix')),
    ethanol_pct     double precision,
    full_tank       boolean NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, local_id)
);
CREATE INDEX fuel_ups_device_ts_idx ON fuel_ups (device_id, ts DESC);
