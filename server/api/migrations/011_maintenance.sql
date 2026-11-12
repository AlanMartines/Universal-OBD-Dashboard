-- Manutenção registrada no app (aba Manutenção), espelhada no painel. O app manda a lista inteira do veículo
-- (itens e registros) e o painel troca tudo de uma vez. Edição só no app. A observação de cada registro
-- (oficina) fica no celular: revelaria por onde a pessoa anda.
CREATE TABLE maintenance_items (
    device_id        uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    local_id         bigint NOT NULL,
    name             text NOT NULL,
    interval_km      double precision,
    interval_months  integer,
    next_km          double precision,
    next_at          timestamptz,
    notes            text,
    received_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, local_id)
);

CREATE TABLE maintenance_records (
    device_id      uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    local_id       bigint NOT NULL,
    item_local_id  bigint NOT NULL,
    ts             timestamptz NOT NULL,
    odometer_km    double precision,
    cost           double precision,
    PRIMARY KEY (device_id, local_id)
);
CREATE INDEX maintenance_records_item_idx ON maintenance_records (device_id, item_local_id, ts DESC);
