import { PASSWORD_MAX } from './security.js';

export const LOCK_AFTER = 5;
export const LOCK_MAX_MINUTES = 60;
export const PAIRING_MINUTES = 10;
export const MAX_LIVE_PER_USER = 5;
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const uuidParam = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', format: 'uuid' } },
};

export const deviceName = { type: 'string', minLength: 1, maxLength: 60, pattern: '^[^\\u0000-\\u001f<>]+$' };
export const passwordField = { type: 'string', minLength: 1, maxLength: PASSWORD_MAX * 4 };

export const sampleSchema = {
  type: 'object',
  required: ['seq', 'ts', 'metrics'],
  additionalProperties: false,
  properties: {
    seq: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    ts: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
    tripId: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    metrics: {
      type: 'object',
      maxProperties: 120,
      additionalProperties: false,
      patternProperties: { '^[A-Za-z0-9_.-]{1,48}$': { type: 'number' } },
    },
    dtcs: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[PCBU][0-9A-F]{4}$' },
    },
    gps: {
      type: 'object',
      required: ['lat', 'lon'],
      additionalProperties: false,
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lon: { type: 'number', minimum: -180, maximum: 180 },
        speedKmh: { type: ['number', 'null'], minimum: 0, maximum: 1000 },
        accuracyM: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
      },
    },
  },
};
