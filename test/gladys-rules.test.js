// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on the device discovered from realistic
// fixtures (real NetBox 4.7.5 answers: prefixes in two VRFs, a container, an
// IPv6 prefix) — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HOST, READ_ONLY_TOKEN, TOKEN, createNetBox } from './helpers/fakeNetBox.js';
import { createWorld } from './helpers/world.js';

const PREFIXES = '192.0.2.0/24, 10.0.0.0/16, 198.51.100.0/24, 2001:db8::/64, 203.0.113.0/28';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'default language (French)', language: undefined, token: TOKEN },
  { label: 'English names', language: 'en', token: TOKEN },
  { label: 'German names, v2 token', language: 'de', token: READ_ONLY_TOKEN },
  { label: 'Spanish names', language: 'es', token: TOKEN },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { fake, app } = await createWorld({
      server: createNetBox(),
      config: {
        url: HOST,
        api_token: scenario.token,
        prefixes: PREFIXES,
        ...(scenario.language ? { language: scenario.language } : {}),
      },
    });
    try {
      const devices = fake.discoveredDevices;
      // The instance, 192.0.2.0/24, the container, 198.51.100.0/24 in two
      // VRFs, the IPv6 prefix and 203.0.113.0/28.
      assert.equal(devices.length, 7, devices.map((d) => d.name).join(', '));
      assert.equal(new Set(devices.map((d) => d.external_id)).size, devices.length);
      assert.equal(new Set(devices.map((d) => d.name)).size, devices.length);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}
