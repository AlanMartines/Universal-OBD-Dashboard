'use strict';

/*
 * Simulador de percurso para pré-visualizar o painel fora do app (navegador ou página de
 * protótipo). Dentro do app (window.AndroidBridge presente) não faz nada.
 *
 * Gera o mesmo formato de MainActivity.stateJson a 4 Hz, com o perfil do Fiat Uno Vivace:
 * aquecimento, arrancadas com trocas de marcha, cruzeiro, corte de injeção, paradas.
 *
 *   ObdSim.meta                  metadados do perfil (formato de profileMetaJson)
 *   ObdSim.start(cb)             chama cb(state) a cada 250 ms
 *   ObdSim.scenario('drive'|'sport'|'overheat'|'mil')
 */
window.ObdSim = (function () {
  if (window.AndroidBridge) return null;

  const meta = {
    id: 'fiat_uno_vivace_7gf', vehicleName: 'Fiat Uno Vivace 1.0 Flex', ecuModel: 'Magneti Marelli IAW 7GF',
    engine: 'Fire EVO 1.0 8V Flex (999 cm³)', protocol: 'ISO_15765_4_CAN_11BIT_500K',
    roles: {
      rpm: 'rpm', speed: 'speed', coolant: 'coolant_temp', voltage: 'battery_volts', throttle: 'throttle', map: 'map',
      intake: 'intake_temp', engineLoad: 'engine_load', timing: 'timing_advance', stft: 'stft_b1', ltft: 'ltft_b1',
      lambda: 'lambda_b1s1_v', milOn: 'mil_on', dtcCount: 'dtc_count',
    },
    dashboard: { rpmMax: 7000, rpmRedline: 6250, speedMax: 200, voltageMin: 11, voltageMax: 15.5 },
    thermal: { thermostatOpenC: 87, fanStage1C: 97, fanStage2C: 103, criticalC: 105 },
    fuel: { tankCapacityL: 48, reserveMinL: 5.5, reserveMaxL: 7.5, flex: true, defaultEthanolPct: 0 },
    upshiftSpeedsKmh: [14.8, 28.2, 43.8, 61.4],
    outputs: [],
  };

  // km/h a cada 1000 RPM por marcha (estimativa para o Fire 1.0 com pneu 175/65 R14)
  const RATIO = [7.4, 13.3, 19.6, 26.4, 33.2];
  const UPSHIFT = meta.upshiftSpeedsKmh;
  // Roteiro de velocidade-alvo (km/h) e duração (s)
  const ROUTE = [[0, 8], [52, 14], [52, 10], [96, 16], [96, 14], [38, 9], [38, 8], [0, 8], [0, 5], [74, 13], [74, 12], [0, 10]];

  let sc = 'drive';
  let timer = 0;
  let t0 = Date.now();
  const v = {
    speed: 0, rpm: 850, gear: 0, clutchUntil: 0, coolant: 58, iat: 34, fuelL: 31.5, tripKm: 0, tripFuelL: 0,
    leg: 0, legT: 0, lambdaPh: 0, ltft: 2.3,
  };
  const noise = (a) => (Math.random() - 0.5) * 2 * a;

  function step(dt) {
    const now = Date.now();
    const [goal, dur] = ROUTE[v.leg];
    v.legT += dt;
    if (v.legT >= dur) { v.legT = 0; v.leg = (v.leg + 1) % ROUTE.length; }

    // Dinâmica longitudinal simples
    const diff = goal - v.speed;
    const sport = sc === 'sport';
    const accel = diff > 1 ? Math.min(diff, (v.gear <= 2 ? 6.5 : v.gear === 3 ? 4.2 : 2.8) * (sport ? 1.5 : 1)) : diff < -1 ? Math.max(diff, -7.5) : diff;
    const shifting = now < v.clutchUntil;
    v.speed = Math.max(0, v.speed + (shifting ? -0.4 : accel) * dt);
    const accelerating = diff > 1 && !shifting;
    const decelerating = diff < -1;

    // Marcha: sobe pela tabela de troca econômica com folga; reduz abaixo de ~1300 RPM
    if (v.speed < 2) v.gear = goal > 0 ? 1 : 0;
    else {
      if (v.gear === 0) v.gear = 1;
      const rpmNow = v.speed / RATIO[v.gear - 1] * 1000;
      const upAt = (UPSHIFT[v.gear - 1] || Infinity) + 6;
      const up = sport ? rpmNow > 6350 : v.speed > upAt || rpmNow > 3600;
      if (accelerating && v.gear < 5 && up) { v.gear++; v.clutchUntil = now + (sport ? 350 : 550); }
      else if (v.gear > 1 && rpmNow < 1300 && !decelerating) v.gear--;
      else if (v.gear > 1 && decelerating && rpmNow < 1100) v.gear--;
    }

    // RPM
    let rpm;
    if (v.gear === 0 || v.speed < 2) rpm = (v.coolant < 70 ? 1050 : 850) + noise(15) + (goal > 0 ? 400 : 0);
    else rpm = Math.max(900, v.speed / RATIO[v.gear - 1] * 1000);
    if (shifting) rpm = Math.max(1200, rpm * 0.82);
    v.rpm += (rpm - v.rpm) * Math.min(1, dt * 6);

    // Carga
    const cruiseTps = 8 + v.speed * 0.2;
    const tps = shifting ? 0 : accelerating ? (sport ? 85 : 38 + (v.gear >= 4 ? 10 : 0)) + noise(6) : decelerating ? 0 : v.speed > 2 ? cruiseTps + noise(1.5) : 0;
    const fuelCut = decelerating && v.rpm > 1500 && tps < 1;
    const map = fuelCut ? 23 + noise(1) : v.speed < 2 && tps < 1 ? 33 + noise(1) : clamp(28 + tps * 1.45 + noise(2), 25, 97);

    // Temperaturas
    const fanOn = v.coolant >= meta.thermal.fanStage1C;
    const heat = sc === 'overheat' ? 0.9 : v.coolant < 88 ? 0.55 : 0.05 + tps * 0.004;
    // No cenário de superaquecimento o eletroventilador "falhou": quase não resfria.
    const fanGain = sc === 'overheat' ? 0.004 : fanOn ? 0.09 : 0.02;
    const cool = v.coolant > 88 ? (v.coolant - 88) * fanGain + v.speed * (sc === 'overheat' ? 0 : 0.0006) : 0;
    v.coolant = clamp(v.coolant + (heat - cool) * dt, 40, 112);
    const iatGoal = v.speed > 20 ? 31 : 39;
    v.iat += (iatGoal - v.iat) * dt * 0.05;

    // Sonda estreita: oscila em malha fechada, pobre no corte, rica em carga plena
    v.lambdaPh += dt * 2 * Math.PI * 1.1;
    const lambda = fuelCut ? 0.05 + noise(0.02) : map > 85 ? 0.82 + noise(0.03) : 0.45 + 0.38 * Math.sin(v.lambdaPh) + noise(0.03);
    const stft = fuelCut ? 0 : clamp(noise(3.5) + (lambda > 0.6 ? -2 : 2), -12, 12);

    // Consumo (speed-density como em FuelCalculator)
    const iatK = v.iat + 273.15;
    const airGs = map * 1000 * 0.000999 * (v.rpm / 120) * 0.8 / (287.05 * iatK) * 1000;
    const lph = fuelCut || v.rpm < 300 ? 0 : airGs / 13.0 * (1 + (stft + v.ltft) / 100) * 3600 / 745;
    v.fuelL = Math.max(0, v.fuelL - lph * dt / 3600);
    v.tripFuelL += lph * dt / 3600;
    v.tripKm += v.speed * dt / 3600;

    const est = v.speed >= 3 && !shifting ? v.gear : null;
    const rec = v.speed < 3 ? 1 : 1 + UPSHIFT.filter((x) => v.speed >= x).length;
    const shiftUp = !!est && est < rec && tps < 60 && v.rpm > 2400;

    const volts = (v.rpm > 600 ? 14.15 : 12.55) + noise(0.04);
    const mil = sc === 'mil';
    const readings = {
      rpm: v.rpm, speed: Math.round(v.speed), throttle: tps, map: Math.round(map), coolant_temp: Math.round(v.coolant),
      intake_temp: Math.round(v.iat), battery_volts: volts, timing_advance: fuelCut ? 6 : accelerating ? 16 + noise(2) : 28 + noise(3),
      engine_load: clamp(map * 0.95, 0, 100), lambda_b1s1_v: clamp(lambda, 0, 1.2), lambda_b1s1_trim: 0,
      stft_b1: stft, ltft_b1: v.ltft, mil_on: mil ? 1 : 0, dtc_count: mil ? 1 : 0,
    };

    const alerts = [];
    const c = readings.coolant_temp;
    if (c > 105) alerts.push({ id: 'coolant_critical', level: 'CRITICAL', message: `Superaquecimento: ${c} °C. Pare em local seguro.` });
    else if (c >= 103) alerts.push({ id: 'coolant_fan2', level: 'WARNING', message: `Temperatura alta (${c} °C): eletroventilador em 2ª.` });
    if (mil) alerts.push({ id: 'mil_on', level: 'CRITICAL', message: 'Luz de injeção (MIL) acesa: 1 falha armazenada.' });
    if (v.rpm >= 6250) alerts.push({ id: 'rpm_redline', level: 'CRITICAL', message: `Faixa vermelha: ${Math.round(v.rpm)} RPM` });

    return {
      running: true, diagRecording: true, profileId: meta.id, vehicleName: meta.vehicleName,
      connection: 'STREAMING', statusMessage: 'Capturando • ' + meta.ecuModel, power: 'ACTIVE',
      readings,
      derived: {
        fuelLph: lph, instantKmPerL: lph > 0.05 && v.speed > 5 ? v.speed / lph : null,
        tripKmPerL: v.tripFuelL > 0.02 ? v.tripKm / v.tripFuelL : null, tripFuelUsedL: v.tripFuelL,
        fuelRemainingL: v.fuelL, recommendedGear: rec, estimatedGear: est, shiftUp,
      },
      gps: { lat: -20.4697, lon: -54.6201, speedKmh: v.speed * 0.97, accuracyM: 4, ageMs: 300 },
      alerts, confirmedDtcs: mil ? ['P0133'] : [], pendingDtcs: [],
      tripId: 1, tripStartedAt: t0, tripDistanceKm: v.tripKm, totalKm: 1846.2 + v.tripKm, adapterVersion: 'ELM327 v1.5', disabledPids: [],
    };
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function start(cb) {
    clearInterval(timer);
    // Começa já com a viagem em andamento (painel completo na primeira tela)
    t0 = Date.now() - 23 * 60000;
    v.coolant = 84; v.tripKm = 14.6; v.tripFuelL = 1.12; v.fuelL = 29.8; v.leg = 3; v.legT = 6; v.speed = 70; v.gear = 4;
    cb(step(0.25));
    timer = setInterval(() => cb(step(0.25)), 250);
  }

  function scenario(name) {
    sc = name;
    if (name === 'overheat') v.coolant = Math.max(v.coolant, 99);
    if (name === 'drive' && v.coolant > 95) v.coolant = 91;
  }

  return { meta, start, scenario };
})();
