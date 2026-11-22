// The integration end to end: the SDK's fake Gladys, the wiring of
// src/app.js and the fake NetBox built on real NetBox 4.7.5 answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MemoryStore } from '../src/store.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  HOST,
  LIMITED_TOKEN,
  READ_ONLY_TOKEN,
  TOKEN,
  createNetBox,
  settle,
} from './helpers/fakeNetBox.js';
import { INSTANCE, createAll, createWorld, feature, prefixDevice } from './helpers/world.js';

const prefixFeature = (id, key) => `${prefixDevice(id)}:${key}`;

test('the instance and one device per followed prefix, their states once added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    [
      'NetBox',
      'Préfixe 192.0.2.0/24',
      'Préfixe 10.0.0.0/16',
      'Préfixe 198.51.100.0/24',
      'Préfixe 198.51.100.0/24 (Office)',
    ],
  );
  assert.equal(devices[0].external_id, INSTANCE);
  assert.equal(devices[0].model, 'NetBox 4.7.5');
  assert.ok(devices.every((d) => d.should_poll === false));
  assert.equal(world.fake.states.length, 0, 'nothing before the devices are added');
  assert.equal(world.fake.connectionStatus.connected, true);

  await createAll(world.fake);
  const last = (id) => world.fake.lastState(id);
  assert.equal(last(feature('reachable')), 1);
  assert.equal(last(feature('version')), '4.7.5');
  assert.equal(last(feature('devices_active')), 2);
  assert.equal(last(feature('devices_offline')), 1);
  assert.equal(last(feature('devices_failed')), 1);
  assert.equal(last(feature('ip_addresses')), 9);
  assert.equal(last(feature('virtual_machines')), 2);
  assert.equal(last(feature('last_change')), 'Création · pihole-vm · admin');
  // NetBox 4.7.5 shows 21.26 %, 1.17 %, 0.39 % and 0.79 % for them.
  assert.equal(last(prefixFeature(1, 'utilization')), 21);
  assert.equal(last(prefixFeature(1, 'free_addresses')), 200);
  assert.equal(last(prefixFeature(2, 'utilization')), 1);
  assert.equal(last(prefixFeature(2, 'free_addresses')), 65536 - 768);
  assert.equal(last(prefixFeature(5, 'free_addresses')), 253);
  assert.equal(last(prefixFeature(6, 'free_addresses')), 252, 'the VRF Office has two');
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('a prefix by its number; a missing one is reported, then a deleted one disappears', async (t) => {
  const server = createNetBox();
  const world = await createWorld({
    server,
    config: { url: HOST, api_token: TOKEN, prefixes: '7, 2001:db8::/64, 192.0.2.0/25, 99' },
  });
  t.after(() => world.app.stop());
  await createAll(world.fake);
  assert.equal(world.fake.lastState(prefixFeature(7, 'utilization')), 100, 'mark_utilized');
  assert.equal(world.fake.lastState(prefixFeature(8, 'free_addresses')), 4_294_967_296, 'capped');
  const ack = await world.fake.action('test_connection');
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.match(
    ack.data?.message?.fr ?? JSON.stringify(ack),
    /Introuvable\(s\) : 192\.0\.2\.0\/25, 99/,
  );

  server.remove('ipam/prefixes', 7);
  await world.hub.refresh();
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    ['NetBox', 'Préfixe 2001:db8::/64'],
  );
});

test('trigger "Prefix almost full": once, again after going below the threshold', async (t) => {
  const server = createNetBox();
  const store = new MemoryStore();
  const config = { url: HOST, api_token: TOKEN, prefixes: '192.0.2.0/24', usage_threshold: 22 };
  const world = await createWorld({ server, store, config });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, '21.26 % is below 22 %');
  const ip = (id, address) => ({ id, address, vrf: null, status: { value: 'active' } });
  server.add('ipam/ip-addresses', ip(50, '192.0.2.20/24'));
  server.add('ipam/ip-addresses', ip(51, '192.0.2.21/24'));
  await world.hub.refresh();
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => [e.key, e.data]),
    [
      [
        TRIGGERS.usage,
        {
          device: prefixDevice(1),
          prefix: '192.0.2.0/24',
          vrf: '',
          utilization: 22,
          free_addresses: 198,
          threshold: 22,
        },
      ],
    ],
  );
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 1, 'once');
  assert.deepEqual(store.data.high, [1], 'remembered across restarts');

  server.remove('ipam/ip-addresses', 51);
  await world.hub.refresh();
  server.add('ipam/ip-addresses', ip(52, '192.0.2.22/24'));
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 2, 'again after going below');
});

test('trigger "Device created or deleted": a silent baseline, then each change once', async (t) => {
  const server = createNetBox();
  const store = new MemoryStore();
  const world = await createWorld({ server, store });
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'the five past creations are not announced');
  assert.equal(store.data.lastChangeId, 9, 'the creation of router-02');

  const created = server.change('create', 'dcim.device', 6, 'fw-01', 'alice');
  server.change('update', 'dcim.device', 6, 'fw-01');
  server.change('create', 'dcim.site', 2, 'Office');
  server.change('delete', 'dcim.device', 3, 'nas-01');
  await world.hub.refresh();
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => [e.key, e.data]),
    [
      [
        TRIGGERS.device,
        {
          action: 'create',
          action_text: 'Création',
          device: 'fw-01',
          device_id: 6,
          user: 'alice',
          time: `2026-11-22T12:${String(created % 60).padStart(2, '0')}:00.000000Z`,
        },
      ],
      [
        TRIGGERS.device,
        {
          action: 'delete',
          action_text: 'Suppression',
          device: 'nas-01',
          device_id: 3,
          user: 'admin',
          time: world.fake.sceneEvents[1].data.time,
        },
      ],
    ],
  );
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 2, 'once');

  // A restart with the saved state announces nothing again.
  await world.app.stop();
  const again = await createWorld({ server, store });
  t.after(() => again.app.stop());
  assert.equal(again.fake.sceneEvents.length, 0);
});

test('NetBox before 4.1: the change log is read from extras', async (t) => {
  const server = createNetBox({ changesApp: 'extras' });
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  await createAll(world.fake);
  assert.equal(world.fake.lastState(feature('last_change')), 'Création · pihole-vm · admin');
  assert.ok(server.state.requests.some((r) => r.startsWith('GET extras/object-changes')));
});

test('scene action: a journal entry on a device given by name or number', async (t) => {
  const server = createNetBox();
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  let ack = await world.fake.sceneAction('add_journal_entry', {
    device: ' UPS-RACK1 ',
    kind: 'warning',
    comments: 'UPS on battery',
  });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(ack.data.outputs, { entry_id: 100, device: 'ups-rack1' });
  assert.deepEqual(
    [server.state.journal[0].assigned_object_id, server.state.journal[0].kind],
    [4, 'warning'],
  );
  ack = await world.fake.sceneAction('add_journal_entry', { device: '2', comments: 'Rebooted' });
  assert.equal(ack.success, true);
  assert.equal(server.state.journal[1].kind, 'info', 'empty kind: info');
  assert.equal(ack.data.outputs.device, 'ap-living-room');
});

test('scene action failures are errors (red), in the four languages', async (t) => {
  const server = createNetBox();
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  const fail = async (fields, pattern) => {
    const ack = await world.fake.sceneAction('add_journal_entry', fields);
    assert.equal(ack.success, false, JSON.stringify(fields));
    assert.match(ack.error.fr, pattern);
    assert.ok(ack.error.en && ack.error.de && ack.error.es);
  };
  await fail({ device: '', comments: 'x' }, /nom d'un équipement/);
  await fail({ device: 'sw-core-01', comments: '  ' }, /texte de l'entrée/);
  await fail({ device: 'nope', comments: 'x' }, /Aucun équipement NetBox/);
  const original = server.state.lists['dcim/devices'].find((d) => d.name === 'sw-core-01');
  server.add('dcim/devices', { ...original, id: 9 });
  await fail({ device: 'sw-core-01', comments: 'x' }, /Plusieurs équipements/);

  const readOnly = await createWorld({
    server,
    config: { url: HOST, api_token: READ_ONLY_TOKEN },
  });
  t.after(() => readOnly.app.stop());
  const ack = await readOnly.fake.sceneAction('add_journal_entry', {
    device: 'nas-01',
    comments: 'x',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /ne peut pas ajouter/);

  server.goDown();
  await fail({ device: 'nas-01', comments: 'x' }, /n'a pas pu être lu/);
});

test('NetBox down: reachable at 0, a status, and the last values kept', async (t) => {
  const server = createNetBox();
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  await createAll(world.fake);
  server.goDown();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(feature('reachable')), 0);
  assert.equal(world.fake.lastState(feature('devices_active')), 2, 'last value kept');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /NetBox ne répond pas/);
  const widget = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.match(JSON.stringify(widget.data), /dernières valeurs lues|last values read/);
  const ack = await world.fake.action('test_connection');
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /NetBox ne répond pas/);

  server.goUp();
  await world.hub.refresh();
  assert.equal(world.fake.lastState(feature('reachable')), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a wrong token, a token without the rights, a missing configuration', async (t) => {
  for (const [config, pattern] of [
    [{ url: HOST, api_token: 'Token 0000' }, /Jeton refusé/],
    [{ url: HOST, api_token: LIMITED_TOKEN }, /ne peut pas lire/],
    [{ url: HOST }, /Saisissez un jeton/],
    [{ url: 'ftp://x' }, /pas valide/],
  ]) {
    const world = await createWorld({ config });
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.fr, pattern);
    assert.equal(world.fake.discoveredDevices.length, 0);
    const ack = await world.fake.action('test_connection');
    assert.equal(ack.success, false);
    assert.match(ack.error.fr, pattern);
  }
});

test('the language renames the features; a new address keeps the devices', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({
    url: `${HOST}/api/`,
    api_token: `Token ${TOKEN}`,
    prefixes: '192.0.2.0/24',
    language: 'en',
  });
  await settle(20);
  const [instance, prefix] = world.fake.discoveredDevices;
  assert.equal(instance.external_id, INSTANCE);
  assert.deepEqual(
    instance.features.map((f) => f.name),
    [
      'NetBox reachable',
      'NetBox version',
      'Active devices',
      'Offline devices',
      'Failed devices',
      'IP addresses',
      'Virtual machines',
      'Last change',
    ],
  );
  assert.equal(prefix.name, 'Prefix 192.0.2.0/24');
  assert.equal(prefix.external_id, prefixDevice(1));
});

test('the widget: tiles, then the fullest prefixes, the last changes or nothing', async (t) => {
  const world = await createWorld({
    devices: [{ external_id: prefixDevice(1), name: 'Home LAN', features: [] }],
  });
  t.after(() => world.app.stop());
  const get = async (settings, language = 'fr') => {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
    assert.equal(ack.success, true, JSON.stringify(ack.error));
    assert.deepEqual(validateWidgetContent(ack.data.content), []);
    return ack.data.content;
  };
  const content = await get({});
  const types = content.components.map((c) => c.type);
  assert.deepEqual(types, ['value', 'value', 'value', 'value', 'card-list']);
  assert.deepEqual(
    content.components.slice(0, 4).map((c) => c.value),
    [2, 2, 9, 2],
  );
  const prefixes = content.components[4];
  assert.deepEqual(prefixes.items[0], {
    title: 'Home LAN',
    subtitle: '200 libres',
    badge: { text: '21 %', color: prefixes.items[0].badge.color },
  });
  const changes = (await get({ list: 'changes' })).components[4];
  assert.equal(changes.items.length, 5);
  assert.equal(changes.items[0].title, 'pihole-vm · admin');
  assert.equal(changes.items[0].badge.text, 'Création');
  assert.equal((await get({ list: 'none' })).components.length, 4);
});

test('a created device gets all its states again; a poll republishes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [instance] = world.fake.discoveredDevices;
  await world.fake.deviceCreated(instance);
  await settle();
  const count = world.fake.states.length;
  assert.ok(count >= 8);
  await world.fake.poll(instance);
  await settle();
  assert.ok(world.fake.states.length > count, 'poll sends the states again');
});
