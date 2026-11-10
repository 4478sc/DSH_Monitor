/**
 * Runtime settings for session grants.
 *
 * The cordis plugin config is a deploy-time file; the toggles a user flips in
 * Settings → Attention Toast must not require editing it and restarting. So the
 * two user-facing switches live in `<ledgerDir>/settings.json`, which overrides
 * the static config when present, and which the UI reads/writes through the
 * `attentionToast` service.
 *
 * Anything malformed falls back to the static config — a broken settings file
 * must never enable auto-approval by accident.
 *
 * @module approval-toast/session-grants-settings
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Defaults shared by the plugin config and the settings file. */
export const DEFAULT_GRANTS = {
  enabled: false,
  /** How long one grant stays valid. */
  ttlMs: 30 * 60 * 1000,
  /** How many requests one grant may answer. */
  maxUses: 20,
  /** Full-disk escalations are never remembered unless this is on. */
  allowDangerFullAccess: false,
  /** Upper bound for a danger-full-access grant (hard cap: 5). */
  dangerMaxUses: 5,
  /** Regexes that always fall back to asking. */
  alwaysAsk: [],
};

export const DANGER_MAX_USES_LIMIT = 5;

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

/** Normalize a config or settings block; unknown/invalid fields fall back. */
export function normalizeGrants(input) {
  const raw = input !== null && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled === true,
    ttlMs: clampNumber(raw.ttlMs, DEFAULT_GRANTS.ttlMs, 60_000, 24 * 60 * 60 * 1000),
    maxUses: clampNumber(raw.maxUses, DEFAULT_GRANTS.maxUses, 1, 1000),
    allowDangerFullAccess: raw.allowDangerFullAccess === true,
    dangerMaxUses: clampNumber(raw.dangerMaxUses, DEFAULT_GRANTS.dangerMaxUses, 1, DANGER_MAX_USES_LIMIT),
    alwaysAsk: Array.isArray(raw.alwaysAsk) ? raw.alwaysAsk.map(String) : [],
  };
}

export function settingsFile(dir) {
  return dir + '/settings.json';
}

/** Stored overrides; a missing or corrupt file means "nothing overridden". */
export function readSettings(dir) {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(dir), 'utf8'));
    const grants = raw?.sessionGrants !== null && typeof raw?.sessionGrants === 'object' ? raw.sessionGrants : {};
    const out = { version: 1, sessionGrants: {} };
    if (typeof grants.enabled === 'boolean') out.sessionGrants.enabled = grants.enabled;
    if (typeof grants.allowDangerFullAccess === 'boolean') {
      out.sessionGrants.allowDangerFullAccess = grants.allowDangerFullAccess;
    }
    return out;
  } catch {
    return { version: 1, sessionGrants: {} };
  }
}

/** Merge a patch into the stored overrides (atomic temp + rename). */
export function writeSettings(dir, patch) {
  const current = readSettings(dir);
  const next = { version: 1, sessionGrants: { ...current.sessionGrants } };
  const grants = patch?.sessionGrants !== null && typeof patch?.sessionGrants === 'object' ? patch.sessionGrants : patch ?? {};
  if (typeof grants.enabled === 'boolean') next.sessionGrants.enabled = grants.enabled;
  if (typeof grants.allowDangerFullAccess === 'boolean') next.sessionGrants.allowDangerFullAccess = grants.allowDangerFullAccess;
  const file = settingsFile(dir);
  const temp = file + '.tmp';
  mkdirSync(dir, { recursive: true });
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(temp, file);
  return next;
}

/** Static config first, then the user's stored overrides. */
export function effectiveGrants(configGrants, dir) {
  const base = normalizeGrants(configGrants);
  const stored = readSettings(dir).sessionGrants;
  return {
    ...base,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : base.enabled,
    allowDangerFullAccess: typeof stored.allowDangerFullAccess === 'boolean'
      ? stored.allowDangerFullAccess
      : base.allowDangerFullAccess,
  };
}
