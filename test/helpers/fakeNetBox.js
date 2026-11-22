// -----------------------------------------------------------------------------
// A fake NetBox behind a `fetch` function. Its objects are the answers
// recorded on a real NetBox 4.7.5 (test/fixtures/netbox/4.7.5/, demo data
// loaded through the API), and it answers like that server: the same list
// envelope, the same filters, the same status codes and bodies for a wrong
// token (403 "Invalid v1 token"), a token without the permission (403) and an
// invalid journal entry (400).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { parseCidr } from '../../src/netbox/model.js';

export const HOST = 'http://192.0.2.40:8000';
// A v1 token (40 hexadecimal characters) with every right.
export const TOKEN = '0123456789abcdef0123456789abcdef01234567';
// A v2 token (NetBox 4.5+), read only.
export const READ_ONLY_TOKEN = 'nbt_AbCdEfGh1234.s3cr3tv2tokenvaluefortests0123456789';
// A token whose user may only read the devices.
export const LIMITED_TOKEN = 'fedcba9876543210fedcba9876543210fedcba98';

export const fixture = (name, version = '4.7.5') =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/netbox/${version}/${name}`, import.meta.url), 'utf8'),
  );

export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const LISTS = {
  'dcim/devices': 'devices.json',
  'ipam/prefixes': 'prefixes.json',
  'ipam/ip-addresses': 'ip-addresses.json',
  'ipam/ip-ranges': 'ip-ranges.json',
  'virtualization/virtual-machines': 'virtual-machines.json',
  'core/object-changes': 'object-changes.json',
};

const within = (child, parent) => {
  const a = parseCidr(child);
  const b = parseCidr(parent);
  return (
    a && b && a.version === b.version && a.start >= b.start && a.start + a.size <= b.start + b.size
  );
};
const host = (address) => address.split('/')[0];
const hostCidr = (address) => `${host(address)}/${address.includes(':') ? 128 : 32}`;
const vrfMatches = (row, value) =>
  value === null || (value === 'null' ? !row.vrf : String(row.vrf?.id) === value);

/** The NetBox filters the integration uses, on one list. */
function filterRows(name, rows, params) {
  const vrf = params.get('vrf_id');
  return rows.filter((row) => {
    if (params.has('status') && row.status?.value !== params.get('status')) {
      return false;
    }
    if (name === 'ipam/prefixes') {
      if (params.has('prefix') && row.prefix !== params.get('prefix')) {
        return false;
      }
      if (
        params.has('within') &&
        (row.prefix === params.get('within') || !within(row.prefix, params.get('within')))
      ) {
        return false;
      }
    }
    if (name === 'ipam/ip-addresses' && params.has('parent')) {
      if (!within(hostCidr(row.address), params.get('parent'))) {
        return false;
      }
    }
    if (name === 'ipam/ip-ranges' && params.has('parent')) {
      const parent = params.get('parent');
      if (
        !within(hostCidr(row.start_address), parent) ||
        !within(hostCidr(row.end_address), parent)
      ) {
        return false;
      }
    }
    if (['ipam/prefixes', 'ipam/ip-addresses', 'ipam/ip-ranges'].includes(name)) {
      if (!vrfMatches(row, vrf)) {
        return false;
      }
    }
    if (
      params.has('changed_object_type') &&
      row.changed_object_type !== params.get('changed_object_type')
    ) {
      return false;
    }
    if (params.has('name__ie') && row.name.toLowerCase() !== params.get('name__ie').toLowerCase()) {
      return false;
    }
    return true;
  });
}

export function createNetBox({ version = '4.7.5', changesApp = 'core' } = {}) {
  const state = {
    status: fixture('status.json', version),
    lists: Object.fromEntries(
      Object.entries(LISTS).map(([name, file]) => [name, fixture(file, version).results]),
    ),
    changesApp,
    journal: [],
    down: false,
    html: false,
    requests: [],
  };
  const answer = (status, body, type = 'application/json') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': type },
    });

  async function fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    let path = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    state.requests.push(`${method} ${path}?${searchParams}`);
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (state.html) {
      return answer(200, '<html>Login</html>', 'text/html');
    }
    const auth = init.headers?.Authorization;
    const token =
      auth === `Token ${TOKEN}`
        ? 'full'
        : auth === `Bearer ${READ_ONLY_TOKEN}`
          ? 'read'
          : auth === `Token ${LIMITED_TOKEN}`
            ? 'limited'
            : null;
    if (!token) {
      return answer(403, fixture('invalid-token.json'));
    }
    if (path === 'status') {
      return answer(200, state.status);
    }
    if (path.endsWith('object-changes')) {
      const app = path.split('/')[0];
      if (app !== state.changesApp) {
        // An unknown API path: NetBox answers its HTML 404 page.
        return answer(404, '<!DOCTYPE html><html>Page not found</html>', 'text/html');
      }
      path = 'core/object-changes';
    }
    if (method === 'POST' && path === 'extras/journal-entries') {
      if (token !== 'full') {
        return answer(403, fixture('forbidden.json'));
      }
      const body = JSON.parse(init.body);
      const device = state.lists['dcim/devices'].find((d) => d.id === body.assigned_object_id);
      if (!device || !['info', 'success', 'warning', 'danger'].includes(body.kind)) {
        return answer(400, fixture('journal-invalid.json'));
      }
      const entry = { ...fixture('journal-entry.json'), id: 100 + state.journal.length, ...body };
      state.journal.push(entry);
      return answer(201, entry);
    }
    // One object: `dcim/devices/12`, `ipam/prefixes/7`.
    const single = path.match(/^(.+)\/(\d+)$/);
    const name = single ? single[1] : path;
    if (!LISTS[name]) {
      return answer(404, '<!DOCTYPE html><html>Page not found</html>', 'text/html');
    }
    if (token === 'limited' && name !== 'dcim/devices') {
      return answer(403, fixture('forbidden.json'));
    }
    const rows = state.lists[name];
    if (single) {
      const row = rows.find((item) => item.id === Number(single[2]));
      return row ? answer(200, row) : answer(404, fixture('not-found.json'));
    }
    const matching = filterRows(name, rows, searchParams);
    const limit = Math.min(Number(searchParams.get('limit') ?? 50), 1000);
    const offset = Number(searchParams.get('offset') ?? 0);
    const ordered =
      name === 'core/object-changes' ? [...matching].sort((a, b) => b.id - a.id) : matching;
    return answer(200, {
      count: matching.length,
      next: null,
      previous: null,
      results: ordered.slice(offset, offset + limit),
    });
  }

  return {
    fetch,
    state,
    goDown() {
      state.down = true;
    },
    goUp() {
      state.down = false;
    },
    add(name, row) {
      state.lists[name].push(row);
    },
    remove(name, id) {
      state.lists[name] = state.lists[name].filter((row) => row.id !== id);
    },
    /** A change in the log, as NetBox records it. */
    change(action, type, objectId, repr, user = 'admin') {
      const rows = state.lists['core/object-changes'];
      const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
      rows.push({
        id,
        time: `2026-11-22T12:${String(id % 60).padStart(2, '0')}:00.000000Z`,
        user_name: user,
        action: { value: action, label: action[0].toUpperCase() + action.slice(1) },
        changed_object_type: type,
        changed_object_id: objectId,
        object_repr: repr,
      });
      return id;
    },
  };
}
