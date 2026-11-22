// -----------------------------------------------------------------------------
// The REST API of NetBox (`<base>/api/...`), the few calls the integration
// needs: counts, prefixes, the change log, and one write (a journal entry).
//
// Facts checked on real servers (see test/fixtures/netbox/ and CLAUDE.md):
// - two kinds of tokens: the v1 tokens (40 hexadecimal characters) go in
//   `Authorization: Token <token>`, the v2 tokens of NetBox 4.5+
//   (`nbt_<key>.<secret>`) in `Authorization: Bearer <token>`;
// - lists answer `{ count, next, previous, results }`; `limit=1` is enough for
//   a count; the server caps `limit` (MAX_PAGE_SIZE, 1000 by default);
// - a wrong token is a 403 `{"detail": "Invalid v1 token"}` (or 401 when the
//   server asks for authentication), a token without the permission a 403
//   `{"detail": "You do not have permission to perform this action."}`;
// - the change log moved from `/api/extras/object-changes/` (3.x, 4.0) to
//   `/api/core/object-changes/` (4.1+): the client tries the new one first.
// -----------------------------------------------------------------------------

export const DEFAULT_TIMEOUT = 20_000;
export const PAGE_SIZE = 1000;
// A bound against a server answering a wrong `count` forever.
const MAX_PAGES = 50;

export class NetBoxError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'timeout' | 'http' | 'invalid' | 'rejected'} kind
   * @param {string} message never carries a credential
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'NetBoxError';
    this.kind = kind;
    this.status = status;
  }
}

/** `Token <v1>` or `Bearer <v2>`, from the shape of the token. */
export function authorization(token) {
  return /^nbt_/i.test(token) ? `Bearer ${token}` : `Token ${token}`;
}

/** The first readable message of a NetBox error body. */
function detailOf(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  if (typeof data.detail === 'string') {
    return data.detail;
  }
  // A validation error: `{ field: ["message"] }`, or a list of them.
  const first = Array.isArray(data) ? data[0] : Object.values(data)[0];
  if (Array.isArray(first) && typeof first[0] === 'string') {
    return first[0];
  }
  return typeof first === 'string' ? first : '';
}

export class NetBoxClient {
  /**
   * @param {object} options
   * @param {string} options.url normalized base URL (see normalizeUrl)
   * @param {string} options.token API token (v1 or v2)
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout]
   */
  constructor({ url, token, fetch: fetchImpl, timeout }) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
    /** `core` (4.1+) or `extras` (3.x, 4.0), once known */
    this.changesApp = null;
  }

  async request(method, path, body) {
    let response;
    try {
      response = await this.fetch(`${this.url}/api${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: authorization(this.token),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeout),
        // A redirect means a login page (SSO proxy), never data: refused below.
        redirect: 'manual',
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new NetBoxError('timeout', `No answer from NetBox within ${this.timeout} ms`);
      }
      // Never the message of an error raised before sending: it may quote the
      // Authorization header.
      const cause = err?.cause?.code ?? err?.name ?? 'error';
      throw new NetBoxError('unreachable', `NetBox unreachable (${cause})`);
    }
    let raw;
    try {
      raw = await response.text();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new NetBoxError('timeout', `No answer from NetBox within ${this.timeout} ms`);
      }
      raw = '';
    }
    const where = path.split('?')[0];
    let data;
    try {
      data = raw === '' ? null : JSON.parse(raw);
    } catch {
      data = undefined;
    }
    const status = response.status;
    const detail = detailOf(data).slice(0, 160);
    if (status === 401 || status === 403) {
      // A refused token and a missing permission are both a 403 in NetBox:
      // only the detail tells them apart.
      const kind =
        status === 401 || /token|credentials|authenticat/i.test(detail)
          ? 'unauthorized'
          : 'forbidden';
      throw new NetBoxError(kind, `${method} ${where}: HTTP ${status}`, status);
    }
    if (status >= 300 && status < 400) {
      throw new NetBoxError('invalid', `${where}: redirected (is this the NetBox address?)`);
    }
    if (status === 404) {
      throw new NetBoxError('not_found', `${method} ${where}: HTTP 404`, status);
    }
    if (status === 400) {
      throw new NetBoxError('rejected', `${method} ${where}: ${detail || 'HTTP 400'}`, status);
    }
    if (status < 200 || status >= 300) {
      throw new NetBoxError(
        'http',
        `${method} ${where}: HTTP ${status}${detail ? `: ${detail}` : ''}`,
        status,
      );
    }
    if (data === undefined) {
      // A proxy login page answering 200 in HTML, for instance.
      throw new NetBoxError('invalid', `${where}: the answer is not JSON (is this NetBox?)`);
    }
    return data;
  }

  get(path) {
    return this.request('GET', path);
  }

  /** A list answer, checked. */
  async page(path, query) {
    const data = await this.get(`${path}?${new URLSearchParams(query)}`);
    if (!data || !Array.isArray(data.results) || !Number.isFinite(Number(data.count))) {
      throw new NetBoxError('invalid', `${path}: NetBox did not answer a list`);
    }
    return data;
  }

  /** The number of objects matching a filter, without reading them. */
  async count(path, query = {}) {
    const data = await this.page(path, { ...query, limit: '1', brief: '1' });
    return Number(data.count);
  }

  /** Every object matching a filter, page after page. */
  async list(path, query = {}) {
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.page(path, {
        ...query,
        limit: String(PAGE_SIZE),
        offset: String(rows.length),
      });
      rows.push(...data.results);
      if (data.results.length === 0 || rows.length >= Number(data.count)) {
        return rows;
      }
    }
    throw new NetBoxError('invalid', `${path}: more than ${MAX_PAGES} pages`);
  }

  /** `{ "netbox-version": "4.4.6", ... }` */
  status() {
    return this.get('/status/');
  }

  /**
   * The latest object changes, newest first (`query` narrows them); `all`
   * reads every page instead of the first one.
   * @param {Record<string, string>} query
   * @param {{ all?: boolean }} [options]
   */
  async changes(query, { all = false } = {}) {
    const order = this.changesApp ? [this.changesApp] : ['core', 'extras'];
    for (const app of order) {
      try {
        const path = `/${app}/object-changes/`;
        const results = all ? await this.list(path, query) : (await this.page(path, query)).results;
        this.changesApp = app;
        return results;
      } catch (err) {
        if (!(err instanceof NetBoxError && err.kind === 'not_found') || app === order.at(-1)) {
          throw err;
        }
      }
    }
    return [];
  }

  /** POST a journal entry; answers the created entry. */
  createJournalEntry(entry) {
    return this.request('POST', '/extras/journal-entries/', entry);
  }
}
