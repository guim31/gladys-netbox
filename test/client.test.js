// The REST client: headers, error kinds and bodies of a real NetBox 4.7.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetBoxClient, NetBoxError, authorization } from '../src/netbox/client.js';
import {
  HOST,
  LIMITED_TOKEN,
  READ_ONLY_TOKEN,
  TOKEN,
  createNetBox,
  fixture,
} from './helpers/fakeNetBox.js';

const client = (token, server = createNetBox()) =>
  new NetBoxClient({ url: HOST, token, fetch: server.fetch, timeout: 200 });

const kindOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof NetBoxError, err.message);
    return err.kind;
  }
  return 'none';
};

test('v1 tokens go as Token, v2 tokens (nbt_) as Bearer', () => {
  assert.equal(authorization(TOKEN), `Token ${TOKEN}`);
  assert.equal(authorization(READ_ONLY_TOKEN), `Bearer ${READ_ONLY_TOKEN}`);
});

test('counts, lists and the status of a real server', async () => {
  const netbox = client(READ_ONLY_TOKEN);
  assert.equal((await netbox.status())['netbox-version'], '4.7.5');
  assert.equal(await netbox.count('/dcim/devices/', { status: 'offline' }), 1);
  const prefixes = await netbox.list('/ipam/prefixes/', { within: '10.0.0.0/16', vrf_id: 'null' });
  assert.deepEqual(
    prefixes.map((p) => p.prefix),
    ['10.0.1.0/24', '10.0.2.0/23'],
  );
});

test('error kinds: wrong token, no permission, not found, HTML, down, 400', async () => {
  assert.equal(await kindOf(client('0000').status()), 'unauthorized');
  assert.equal(await kindOf(client(LIMITED_TOKEN).count('/ipam/ip-addresses/')), 'forbidden');
  assert.equal(await kindOf(client(TOKEN).get('/ipam/prefixes/999/')), 'not_found');
  const server = createNetBox();
  server.state.html = true;
  assert.equal(await kindOf(client(TOKEN, server).status()), 'invalid');
  server.state.html = false;
  server.goDown();
  assert.equal(await kindOf(client(TOKEN, server).status()), 'unreachable');
  server.goUp();
  const rejected = client(TOKEN, server).createJournalEntry({
    assigned_object_type: 'dcim.device',
    assigned_object_id: 4,
    kind: 'nope',
    comments: 'x',
  });
  await assert.rejects(rejected, (err) => {
    assert.equal(err.kind, 'rejected');
    assert.match(err.message, /nope is not a valid choice/);
    return true;
  });
  assert.deepEqual(fixture('invalid-token.json'), { detail: 'Invalid v1 token' });
});

test('the change log: core first, extras on an older NetBox, remembered', async () => {
  const server = createNetBox({ changesApp: 'extras' });
  const netbox = client(TOKEN, server);
  assert.equal((await netbox.changes({ limit: '1' }))[0].object_repr, 'pihole-vm');
  await netbox.changes({ limit: '1' });
  assert.equal(netbox.changesApp, 'extras');
  const asked = server.state.requests.filter((r) => r.includes('object-changes'));
  assert.equal(asked.length, 3, 'core once, then extras twice');
});

test('a timeout is reported as such', async () => {
  const netbox = new NetBoxClient({
    url: HOST,
    token: TOKEN,
    timeout: 20,
    // What fetch rejects with when AbortSignal.timeout fires (its timer does
    // not keep the event loop alive on Node 22: no real wait here).
    fetch: async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
  });
  assert.equal(await kindOf(netbox.status()), 'timeout');
});
