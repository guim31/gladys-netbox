// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, REFRESH_MINUTES, THRESHOLD } from '../src/config.js';
import { JOURNAL_KINDS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { LISTS, WIDGETS } from '../src/widgets.js';
import { HOST, TOKEN } from './helpers/fakeNetBox.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

test('identity: name, image, local transport, services category', () => {
  assert.equal(manifest.name, 'NetBox');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-netbox:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-netbox/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['services']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('widgets, triggers and scene actions need Gladys 5.1.0', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema: the defaults, bounds and options of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual([...keys].sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const item of manifest.config_schema) {
    if (item.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[item.key], item.default, `default of ${item.key}`);
    }
  }
  assert.equal(field('api_token').type, 'secret');
  for (const [key, bounds] of [['usage_threshold', THRESHOLD]]) {
    assert.deepEqual(
      [field(key).min, field(key).max, field(key).default],
      [bounds.min, bounds.max, bounds.default],
    );
  }
  assert.deepEqual(
    field('refresh_minutes').options.map((o) => o.value),
    REFRESH_MINUTES,
  );
  assert.deepEqual(
    field('language').options.map((o) => o.value),
    LANGUAGES,
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields and outputs are the ones the code reads and returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const action = manifest.scene_actions.find((a) => a.key === 'add_journal_entry');
  assert.deepEqual(keysOf(action.fields), ['device', 'kind', 'comments']);
  const ack = await world.fake.sceneAction('add_journal_entry', {
    device: 'nas-01',
    kind: 'danger',
    comments: 'Disk failure',
  });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), keysOf(action.outputs).sort());
  for (const output of action.outputs) {
    assert.equal(typeof ack.data.outputs[output.key], output.type, output.key);
  }
  assert.deepEqual(
    action.fields[1].options.map((o) => o.value),
    JOURNAL_KINDS,
  );
});

test('the scene triggers the hub fires are declared, with exactly their data', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld({
    config: { url: HOST, api_token: TOKEN, prefixes: '203.0.113.0/28' },
  });
  t.after(() => world.app.stop());
  world.server.change('create', 'dcim.device', 6, 'fw-01');
  await world.hub.refresh();
  const events = world.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, trigger.key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    assert.deepEqual(Object.keys(event.data).sort(), declared.sort(), trigger.key);
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, variable.key);
    }
  }
  const actions = manifest.scene_triggers.find((t) => t.key === TRIGGERS.device).fields[0];
  assert.deepEqual(
    actions.options.map((o) => o.value),
    ['create', 'delete'],
  );
});

test('the widget list setting offers the lists of the code', () => {
  const setting = manifest.widgets[0].settings.find((s) => s.key === 'list');
  assert.deepEqual(
    setting.options.map((o) => o.value),
    LISTS,
  );
  assert.equal(setting.default, 'prefixes');
});

test('dynamic selects declare a source and no static options', () => {
  for (const item of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(item.source, 'devices');
    assert.equal(item.options, undefined, item.key);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const item of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (item[key] !== undefined) {
        assert.ok(Number.isInteger(item[key]), `${item.key}.${key}`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const item of action.fields ?? []) {
      assert.notEqual(item.type, 'secret');
      assert.notEqual(item.required, true);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
