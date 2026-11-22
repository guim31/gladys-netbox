// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// a fake NetBox.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { MemoryStore } from '../../src/store.js';
import { HOST, TOKEN, createNetBox, settle } from './fakeNetBox.js';

export const FAST_TIMINGS = { widgetGap: 0, requestTimeout: 200 };
// 2026-11-22, noon UTC: the day the fixtures were recorded.
export const NOW = Date.UTC(2026, 10, 22, 12);

// The prefixes of the demo data: a /24 with addresses and a utilized range,
// a container, and a CIDR present in two VRFs.
export const PREFIXES = '192.0.2.0/24, 10.0.0.0/16, 198.51.100.0/24';

export async function createWorld({
  server = createNetBox(),
  config = { url: HOST, api_token: TOKEN, prefixes: PREFIXES },
  devices = [],
  connect = true,
  store = new MemoryStore(),
  clock = { now: NOW },
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    fetch: server.fetch,
    timings: FAST_TIMINGS,
    now: () => clock.now,
    store,
  });
  if (connect) {
    await gladys.connect();
    await settle(20);
  }
  return { gladys, app, hub: app.hub, server, store, clock, fake: gladys.fake };
}

export const INSTANCE = 'ext:test-integration:netbox:instance';
export const feature = (key) => `${INSTANCE}:${key}`;
export const prefixDevice = (id) => `ext:test-integration:netbox:prefix-${id}`;

/** Add every discovered device to Gladys, as the user would. */
export async function createAll(fake) {
  for (const device of fake.discoveredDevices) {
    await fake.deviceCreated(device);
  }
  await settle();
}
