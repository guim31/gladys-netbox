// -----------------------------------------------------------------------------
// From NetBox answers to what Gladys shows: the address space of a prefix,
// its utilization (computed like NetBox's own `Prefix.get_utilization()`), the
// object changes.
// -----------------------------------------------------------------------------

/**
 * `192.0.2.0/24` -> { version: 4, start, size } (BigInt), or null.
 * @param {string} cidr
 */
export function parseCidr(cidr) {
  const [address, lengthText] = String(cidr).split('/');
  const length = Number(lengthText);
  if (address.includes(':')) {
    const value = parseIpv6(address);
    if (value === null || !Number.isInteger(length) || length < 0 || length > 128) {
      return null;
    }
    const size = 1n << BigInt(128 - length);
    return { version: 6, length, start: value - (value % size), size };
  }
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > 32
  ) {
    return null;
  }
  const value = parts.reduce((total, part) => total * 256n + BigInt(part), 0n);
  const size = 1n << BigInt(32 - length);
  return { version: 4, length, start: value - (value % size), size };
}

function parseIpv6(address) {
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const groups = (text) => (text === '' ? [] : text.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }
  const all = [...head, ...Array(missing).fill('0'), ...tail];
  if (all.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }
  return all.reduce((total, group) => total * 65536n + BigInt(parseInt(group, 16)), 0n);
}

/** The number of addresses covered by a set of CIDRs, overlaps counted once. */
export function unionSize(cidrs) {
  const ranges = cidrs
    .map(parseCidr)
    .filter(Boolean)
    .map(({ start, size }) => [start, start + size])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let total = 0n;
  let current = null;
  for (const [start, end] of ranges) {
    if (current && start <= current[1]) {
      if (end > current[1]) {
        current[1] = end;
      }
    } else {
      if (current) {
        total += current[1] - current[0];
      }
      current = [start, end];
    }
  }
  return current ? total + current[1] - current[0] : total;
}

/** The value of a NetBox choice field (`{ value, label }` in the API, or a plain string). */
export const choice = (field) => (field && typeof field === 'object' ? field.value : field) ?? '';

/**
 * The usable addresses of a prefix, as NetBox counts them: an IPv4 prefix
 * shorter than /31 loses its network and broadcast addresses, unless it is a
 * pool.
 */
export function usableSize(prefix) {
  const net = parseCidr(prefix.prefix);
  if (!net) {
    return 0n;
  }
  return net.version === 4 && net.length < 31 && !prefix.is_pool ? net.size - 2n : net.size;
}

/**
 * The utilization of a prefix, like `Prefix.get_utilization()` of NetBox:
 * - `mark_utilized`: 100 %;
 * - a container: the addresses covered by its child prefixes;
 * - otherwise: its IP addresses, plus the IP ranges marked as utilized.
 * NetBox merges an address that is both in a range and an IP: here they are
 * added, the result being capped (they rarely overlap).
 *
 * @param {object} prefix the NetBox prefix
 * @param {object} children { ipCount, ranges: [{ size, mark_utilized }], childPrefixes: [cidr] }
 * @returns {{ size: bigint, used: bigint, free: bigint, percent: number }}
 */
export function utilization(prefix, { ipCount = 0, ranges = [], childPrefixes = [] } = {}) {
  const net = parseCidr(prefix.prefix);
  if (!net) {
    return { size: 0n, used: 0n, free: 0n, percent: 0 };
  }
  let size;
  let used;
  if (choice(prefix.status) === 'container') {
    size = net.size;
    used = unionSize(childPrefixes);
  } else {
    size = usableSize(prefix);
    used =
      BigInt(Math.max(0, Math.trunc(Number(ipCount) || 0))) +
      ranges
        .filter((range) => range.mark_utilized)
        .reduce((total, range) => total + BigInt(Math.max(0, Number(range.size) || 0)), 0n);
  }
  if (prefix.mark_utilized) {
    used = size;
  }
  if (used > size) {
    used = size;
  }
  // Two decimals, rounded like the 21.26 % NetBox shows for 54 of 254.
  const percent = size === 0n ? 0 : Math.round(Number((used * 1_000_000n) / size) / 100) / 100;
  return { size, used, free: size - used, percent };
}

/**
 * An object change, trimmed to what the integration shows.
 * @param {object} row a NetBox object change
 */
export function parseChange(row) {
  return {
    id: Number(row.id),
    time: typeof row.time === 'string' ? row.time : '',
    action: choice(row.action),
    type: typeof row.changed_object_type === 'string' ? row.changed_object_type : '',
    objectId: Number(row.changed_object_id) || 0,
    name: String(row.object_repr ?? '').trim() || `#${row.changed_object_id}`,
    user: String(row.user_name ?? row.user?.username ?? '').trim(),
  };
}
