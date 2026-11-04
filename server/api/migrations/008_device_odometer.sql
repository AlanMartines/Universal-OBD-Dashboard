-- Último hodômetro conhecido do veículo (do painel pela escuta CAN ou o Total informado no app).
ALTER TABLE devices
    ADD COLUMN odometer_km double precision,
    ADD COLUMN odometer_at timestamptz;
