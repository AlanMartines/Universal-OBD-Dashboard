-- Saúde do carro ao longo do tempo: um resumo por dia e por veículo, montado das amostras antes que a
-- limpeza as apague (RETENTION_DAYS). Fica guardado enquanto o veículo existir.
CREATE TABLE health_daily (
    device_id          uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    day                date NOT NULL,
    samples            integer NOT NULL,
    km                 double precision,
    liters             double precision,
    -- motor aquecido (>= 80 °C): média e máxima do líquido de arrefecimento
    coolant_warm_avg   double precision,
    coolant_max        double precision,
    -- correção curta de combustível (STFT, %) com o motor aquecido, no geral e em marcha lenta
    stft_warm_avg      double precision,
    stft_idle_avg      double precision,
    idle_rpm_avg       double precision,
    -- tensão pelo OBD: com o motor desligado (bateria) e funcionando (carga do alternador)
    volts_off_avg      double precision,
    volts_off_min      double precision,
    volts_running_avg  double precision,
    -- sonda lambda pós-catalisador em velocidade de cruzeiro: média e oscilação (V)
    lambda_post_avg    double precision,
    lambda_post_sd     double precision,
    mil_on             boolean NOT NULL DEFAULT false,
    dtc_max            integer,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, day)
);
