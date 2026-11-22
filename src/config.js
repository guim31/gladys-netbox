// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const REFRESH_MINUTES = ['5', '15', '30', '60'];
export const THRESHOLD = { min: 1, max: 100, default: 90 };
// Prefixes followed at most: each one is a device and a few requests per read.
export const MAX_PREFIXES = 20;

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  prefixes: '',
  usage_threshold: THRESHOLD.default,
  refresh_minutes: '15',
  language: 'fr',
};

/**
 * Turn what the user typed into the base URL of NetBox, without `/api`:
 * - `192.0.2.10:8000` or `netbox.local` (no scheme): http;
 * - `https://example.org/netbox/`: exactly that address (reverse proxy).
 * A pasted `/api` suffix is dropped. Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * The token, without a pasted scheme ("Token 0123…", "Bearer nbt_…"), spaces
 * or control characters.
 */
export function normalizeToken(raw) {
  return (
    (typeof raw === 'string' ? raw.trim() : '')
      .replace(/^(token|bearer)\s+/i, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\s\x00-\x1f\x7f]+/g, '')
  );
}

/**
 * The prefixes to follow: CIDR notations (`192.0.2.0/24`, `2001:db8::/48`)
 * or NetBox prefix ids (`12`), separated by commas, semicolons, spaces or
 * line breaks. Duplicates and malformed entries are dropped (the latter are
 * returned apart, to be reported).
 */
export function parsePrefixes(raw) {
  const entries = (typeof raw === 'string' ? raw : '').split(/[\s,;]+/).filter(Boolean);
  const prefixes = [];
  const invalid = [];
  for (const entry of entries) {
    const value = entry.toLowerCase();
    const valid = /^\d+$/.test(value)
      ? Number(value) > 0
      : /^(\d{1,3}(\.\d{1,3}){3}\/\d{1,2}|[0-9a-f:]+:[0-9a-f:.]*\/\d{1,3})$/.test(value);
    if (!valid) {
      invalid.push(entry);
    } else if (!prefixes.includes(value)) {
      prefixes.push(value);
    }
  }
  return { prefixes: prefixes.slice(0, MAX_PREFIXES), invalid };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function integer(value, { min, max, default: fallback }) {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || value === '') {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = text(source.url);
  const url = normalizeUrl(typed);
  const refresh = String(source.refresh_minutes ?? '');
  const { prefixes, invalid } = parsePrefixes(source.prefixes);
  return {
    url,
    urlInvalid: typed !== '' && url === null,
    apiToken: normalizeToken(source.api_token),
    prefixes,
    invalidPrefixes: invalid,
    threshold: integer(source.usage_threshold, THRESHOLD),
    refreshMinutes: Number(
      REFRESH_MINUTES.includes(refresh) ? refresh : DEFAULT_CONFIG.refresh_minutes,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
