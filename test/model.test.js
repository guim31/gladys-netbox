// The address arithmetic and the utilization, against what NetBox shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCidr, parseChange, unionSize, utilization } from '../src/netbox/model.js';
import { normalizeConfig, normalizeToken, normalizeUrl, parsePrefixes } from '../src/config.js';

test('CIDR parsing, IPv4 and IPv6', () => {
  assert.deepEqual(parseCidr('192.0.2.0/24'), {
    version: 4,
    length: 24,
    start: 3221225984n,
    size: 256n,
  });
  assert.equal(parseCidr('192.0.2.77/24').start, 3221225984n, 'host bits dropped');
  assert.equal(parseCidr('2001:db8::/64').size, 1n << 64n);
  assert.equal(parseCidr('2001:db8::1/128').size, 1n);
  for (const bad of ['192.0.2.0/33', '300.0.0.0/8', '192.0.2/24', '2001:db8::1::/64', 'x']) {
    assert.equal(parseCidr(bad), null, bad);
  }
});

test('the union of child prefixes counts overlaps once', () => {
  assert.equal(unionSize(['10.0.1.0/24', '10.0.2.0/23']), 768n);
  assert.equal(unionSize(['10.0.0.0/24', '10.0.0.0/25', '10.0.0.128/25']), 256n);
  assert.equal(unionSize([]), 0n);
});

test('utilization like NetBox: IPs and utilized ranges, minus network and broadcast', () => {
  const prefix = { prefix: '192.0.2.0/24', status: { value: 'active' }, is_pool: false };
  const usage = utilization(prefix, {
    ipCount: 4,
    ranges: [
      { size: 50, mark_utilized: true },
      { size: 10, mark_utilized: false },
    ],
  });
  assert.equal(usage.size, 254n);
  assert.equal(usage.used, 54n);
  assert.equal(usage.free, 200n);
  assert.equal(usage.percent, 21.26, 'as NetBox 4.7.5 shows it');
  // A pool keeps its first and last addresses.
  assert.equal(utilization({ ...prefix, is_pool: true }, { ipCount: 64 }).percent, 25);
  // Marked as utilized: 100 %.
  const full = utilization({ ...prefix, mark_utilized: true }, { ipCount: 1 });
  assert.deepEqual([full.percent, full.free], [100, 0n]);
  // More addresses than room (overlaps): capped.
  assert.equal(utilization(prefix, { ipCount: 300 }).percent, 100);
});

test('a container counts its child prefixes; IPv6 keeps every address', () => {
  const container = { prefix: '10.0.0.0/16', status: { value: 'container' } };
  const usage = utilization(container, { childPrefixes: ['10.0.1.0/24', '10.0.2.0/23'] });
  assert.equal(usage.percent, 1.17);
  assert.equal(usage.free, 65536n - 768n);
  const v6 = utilization({ prefix: '2001:db8::/64', status: 'active' }, { ipCount: 1 });
  assert.equal(v6.size, 1n << 64n);
  assert.equal(v6.percent, 0);
});

test('an object change is trimmed to what is shown', () => {
  assert.deepEqual(
    parseChange({
      id: 12,
      time: '2026-11-22T11:00:00Z',
      user_name: 'admin',
      action: { value: 'create', label: 'Created' },
      changed_object_type: 'dcim.device',
      changed_object_id: 3,
      object_repr: 'sw-core-01',
    }),
    {
      id: 12,
      time: '2026-11-22T11:00:00Z',
      action: 'create',
      type: 'dcim.device',
      objectId: 3,
      name: 'sw-core-01',
      user: 'admin',
    },
  );
});

test('configuration: address, token, prefixes, threshold', () => {
  assert.equal(normalizeUrl('192.0.2.40:8000'), 'http://192.0.2.40:8000');
  assert.equal(normalizeUrl('https://example.org/netbox/api/'), 'https://example.org/netbox');
  assert.equal(normalizeUrl('http://user:pw@example.org'), null);
  assert.equal(normalizeToken(' Token abc\n'), 'abc');
  assert.equal(normalizeToken('Bearer nbt_x.y'), 'nbt_x.y');
  assert.deepEqual(parsePrefixes('192.0.2.0/24, 12;2001:DB8::/64 192.0.2.0/24 nope 0'), {
    prefixes: ['192.0.2.0/24', '12', '2001:db8::/64'],
    invalid: ['nope', '0'],
  });
  const config = normalizeConfig({ url: 'x y', usage_threshold: '150', refresh_minutes: '7' });
  assert.equal(config.urlInvalid, true);
  assert.equal(config.threshold, 100);
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({}).threshold, 90);
});
