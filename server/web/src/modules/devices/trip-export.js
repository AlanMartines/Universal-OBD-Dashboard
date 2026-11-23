/*
 * Exportar uma viagem pelo painel, no mesmo formato do app (TripExporter.kt): CSV RFC 4180 (vírgula,
 * ponto decimal) com a telemetria e GPX 1.1 com o trajeto, os dados OBD nas extensões e as falhas como
 * waypoints. O GPX só existe quando a API mandou as posições (quem pode ver a localização).
 */
export const GPX_NS = 'http://www.topografix.com/GPX/1/1';
export const OBD_NS = 'https://github.com/AlanMartines/Universal-OBD-Dashboard/gpx/1';
const SEGMENT_GAP_MS = 30000;
const ZONE = 'America/Sao_Paulo';

/** Número sem notação científica nem zeros sobrando; vazio quando não é número. */
export function number(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function csvField(text) {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const xml = (text) => String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** CSV: hora, todos os sinais (em ordem alfabética), velocidade e precisão do GPS, posição (se veio) e falhas. */
export function tripCsv(samples) {
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s.metrics ?? {})))]
    .filter((k) => samples.some((s) => typeof s.metrics?.[k] === 'number'))
    .sort();
  const withPosition = samples.some((s) => 'lat' in s);
  const header = ['timestamp_ms', 'time_utc', ...keys, 'speed_gps_kmh', 'gps_accuracy_m', ...(withPosition ? ['latitude', 'longitude'] : []), 'dtcs'];
  const lines = [header.map(csvField).join(',')];
  for (const s of samples) {
    const at = new Date(s.ts);
    const row = [
      String(at.getTime()), at.toISOString(),
      ...keys.map((k) => number(s.metrics?.[k])),
      number(s.gpsSpeed), number(s.gpsAccuracy),
      ...(withPosition ? [number(s.lat), number(s.lon)] : []),
      (s.dtcs ?? []).join(' '),
    ];
    lines.push(row.map(csvField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** GPX 1.1: trajeto em segmentos (quebra em buraco de mais de 30 s) e a primeira leitura de cada falha. */
export function tripGpx(trip, samples) {
  const name = `Viagem ${new Date(trip.start).toLocaleString('pt-BR', { timeZone: ZONE, dateStyle: 'short', timeStyle: 'short' })}`;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Universal-OBD-Dashboard" xmlns="${GPX_NS}" xmlns:obd="${OBD_NS}">`,
    `  <metadata><name>${xml(name)}</name><time>${new Date(trip.start).toISOString()}</time></metadata>`,
  ];
  const positioned = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  // O esquema GPX exige os waypoints antes das trilhas.
  const seen = new Set();
  for (const s of positioned) {
    for (const code of s.dtcs ?? []) {
      if (seen.has(code)) continue;
      seen.add(code);
      const m = s.metrics ?? {};
      const desc = [m.rpm != null ? `${number(m.rpm)} RPM` : null, m.speed != null ? `${number(m.speed)} km/h` : null, m.coolant_temp != null ? `${number(m.coolant_temp)} °C` : null]
        .filter(Boolean).join(' · ');
      out.push(`  <wpt lat="${number(s.lat)}" lon="${number(s.lon)}"><time>${new Date(s.ts).toISOString()}</time><name>${xml(code)}</name><desc>${xml(desc)}</desc><type>dtc</type></wpt>`);
    }
  }
  out.push(`  <trk><name>${xml(name)}</name>`);
  let lastAt = null;
  for (const s of positioned) {
    const at = new Date(s.ts).getTime();
    if (lastAt === null || at - lastAt > SEGMENT_GAP_MS) {
      if (lastAt !== null) out.push('    </trkseg>');
      out.push('    <trkseg>');
    }
    lastAt = at;
    const m = s.metrics ?? {};
    const ext = [
      ['speed_kmh', m.speed ?? s.gpsSpeed], ['rpm', m.rpm], ['coolant_c', m.coolant_temp],
      ['throttle_pct', m.throttle], ['fuel_lph', m['derived.fuelLph']],
    ].filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
    const extensions = ext.length ? `<extensions>${ext.map(([k, v]) => `<obd:${k}>${number(v)}</obd:${k}>`).join('')}</extensions>` : '';
    out.push(`      <trkpt lat="${number(s.lat)}" lon="${number(s.lon)}"><time>${new Date(at).toISOString()}</time>${extensions}</trkpt>`);
  }
  if (lastAt !== null) out.push('    </trkseg>');
  out.push('  </trk>', '</gpx>', '');
  return out.join('\n');
}

/** Ex.: viagem_7_20261123-0900.csv (início da viagem no horário de Brasília, como no app). */
export function tripFileName(trip, extension) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(trip.start)).map((p) => [p.type, p.value]));
  return `viagem_${trip.id}_${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.${extension}`;
}
