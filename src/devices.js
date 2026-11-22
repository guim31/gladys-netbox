// -----------------------------------------------------------------------------
// The Gladys devices of the integration:
// - `netbox:instance`: the NetBox server (reachable, version, devices by
//   status, IP addresses, virtual machines, last change);
// - `netbox:prefix-<id>`: one per followed prefix (utilization, free addresses).
//
// NetBox has no instance id a token can read: the instance id is fixed, so a
// new address (a new IP, a reverse proxy) keeps the same device, its history
// and its scenes. A prefix is keyed by its NetBox id, never by its CIDR (it can
// be edited, and the same CIDR can exist in several VRFs).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { NAMES, NONE, PREFIX_NAME, describeChange, prefixLabel } from './texts.js';

export const DEVICE_TYPE = 'netbox';
export const INSTANCE_ID = 'instance';
export const prefixId = (id) => `prefix-${id}`;

// Counts of an inventory, and of the addresses of an IPv4 /0 (beyond, the
// value is capped: an IPv6 prefix has more free addresses than a number holds).
const MAX_COUNT = 1_000_000_000;
export const MAX_ADDRESSES = 4_294_967_296;

export const instanceIds = (gladys) => gladys.externalIds(DEVICE_TYPE, INSTANCE_ID);
export const prefixIds = (gladys, id) => gladys.externalIds(DEVICE_TYPE, prefixId(id));

// Instance counters: feature key -> summary -> value.
export const COUNTS = {
  devices_active: (s) => s.devices.active,
  devices_offline: (s) => s.devices.offline,
  devices_failed: (s) => s.devices.failed,
  ip_addresses: (s) => s.ipAddresses,
  virtual_machines: (s) => s.virtualMachines,
};

const featureOf = (ids) => (key, name, fields) => ({
  name,
  external_id: ids.feature(key),
  read_only: true,
  has_feedback: false,
  ...fields,
});

const counter = { category: CAT.COUNTER_SENSOR, type: TYPE.SENSOR.INTEGER, min: 0 };
const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0, keep_history: false };

/**
 * @param {object} gladys
 * @param {string} language
 * @param {string} url NetBox base URL (a device param, shown in Gladys)
 * @param {string | null} version
 */
export function buildInstance(gladys, language, url, version) {
  const names = NAMES[language] ?? NAMES.en;
  const feature = featureOf(instanceIds(gladys));
  return {
    name: 'NetBox',
    external_id: instanceIds(gladys).device,
    model: version ? `NetBox ${version}`.slice(0, 60) : 'NetBox',
    should_poll: false,
    features: [
      feature('reachable', names.reachable, {
        category: CAT.INPUT,
        type: TYPE.SENSOR.BINARY,
        min: 0,
        max: 1,
        keep_history: true,
      }),
      feature('version', names.version, text),
      ...Object.keys(COUNTS).map((key) =>
        feature(key, names[key], { ...counter, max: MAX_COUNT, keep_history: true }),
      ),
      feature('last_change', names.last_change, text),
    ],
    params: [{ name: 'NETBOX_URL', value: url }],
  };
}

/**
 * @param {object} gladys
 * @param {string} language
 * @param {object} prefix a followed prefix of the summary
 */
export function buildPrefix(gladys, language, prefix) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = prefixIds(gladys, prefix.id);
  const feature = featureOf(ids);
  return {
    name: `${PREFIX_NAME[language] ?? PREFIX_NAME.en} ${prefixLabel(prefix)}`.slice(0, 80),
    external_id: ids.device,
    model: prefix.container ? 'NetBox container' : 'NetBox prefix',
    should_poll: false,
    features: [
      // A counter in percent: the only percent categories of Gladys are
      // physical (battery, liquid level...) and would be labeled so.
      feature('utilization', names.utilization, {
        ...counter,
        max: 100,
        unit: UNITS.PERCENT,
        keep_history: true,
      }),
      feature('free_addresses', names.free_addresses, {
        ...counter,
        max: MAX_ADDRESSES,
        keep_history: true,
      }),
    ],
    params: [
      { name: 'NETBOX_PREFIX', value: prefix.cidr },
      { name: 'NETBOX_PREFIX_ID', value: String(prefix.id) },
    ],
  };
}

const cap = (value) => (value > BigInt(MAX_ADDRESSES) ? MAX_ADDRESSES : Number(value));

/** The states of every device, from a summary (`reachable` is the only one when it failed). */
export function buildStates(gladys, summary, language, reachable) {
  const ids = instanceIds(gladys);
  const states = [
    { device_feature_external_id: ids.feature('reachable'), state: reachable ? 1 : 0 },
  ];
  if (!summary || !reachable) {
    return states;
  }
  if (summary.version) {
    states.push({ device_feature_external_id: ids.feature('version'), text: summary.version });
  }
  for (const [key, value] of Object.entries(COUNTS)) {
    states.push({ device_feature_external_id: ids.feature(key), state: value(summary) });
  }
  const [last] = summary.changes;
  states.push({
    device_feature_external_id: ids.feature('last_change'),
    text: (last ? describeChange(last, language) : (NONE[language] ?? NONE.en)).slice(0, 200),
  });
  for (const prefix of summary.prefixes) {
    const prefixFeatures = prefixIds(gladys, prefix.id);
    states.push(
      {
        device_feature_external_id: prefixFeatures.feature('utilization'),
        state: Math.round(prefix.percent),
      },
      {
        device_feature_external_id: prefixFeatures.feature('free_addresses'),
        state: cap(prefix.free),
      },
    );
  }
  return states;
}

/** `instance`, `prefix-<id>` or null when the device is not ours. */
export function deviceKind(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  if (externalId === instanceIds(gladys).device) {
    return 'instance';
  }
  const prefix = gladys.externalIds(DEVICE_TYPE, 'prefix-').device;
  return externalId.startsWith(prefix) && /^\d+$/.test(externalId.slice(prefix.length))
    ? 'prefix'
    : null;
}
