// -----------------------------------------------------------------------------
// The hub: the link to one NetBox and everything Gladys sees of it — the
// devices, their states, the connection status, scene events, the journal
// entries written by scenes.
//
// NetBox pushes nothing: it is read every `refresh_minutes` (15 by default) by
// a timer of the container (should_poll: false, the interval being beyond the
// core's 60 s list). A read is a dozen small requests (counts with `limit=1`,
// the last changes), plus two or three per followed prefix.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  MAX_ADDRESSES,
  buildInstance,
  buildPrefix,
  buildStates,
  deviceKind,
  prefixIds,
} from './devices.js';
import { NetBoxClient, NetBoxError } from './netbox/client.js';
import { choice, parseChange, utilization } from './netbox/model.js';
import { MemoryStore } from './store.js';
import {
  ACTIONS,
  ActionFailure,
  STATUS_TEXT,
  TEST_TEXT,
  commandMessage,
  prefixLabel,
} from './texts.js';

const logger = createLogger({ name: 'netbox-hub' });

export const WIDGET_KEY = 'overview';
export const TRIGGERS = {
  usage: 'prefix_usage_high',
  device: 'device_change',
};
export const JOURNAL_KINDS = ['info', 'success', 'warning', 'danger'];

export const DEFAULT_TIMINGS = {
  // requestWidgetRefresh is dropped by the core beyond one call per 10 s.
  widgetGap: 10_500,
  // An unchanged value is sent again before Gladys calls it stale (48 h).
  heartbeat: 6 * 3_600_000,
  requestTimeout: 20_000,
};

// A bulk import can create hundreds of devices at once: past that many in one
// read, the rest is skipped (and logged).
export const MAX_EVENTS_PER_READ = 10;
// Changes kept for the text feature and the widget.
export const RECENT_CHANGES = 5;

const optionalKinds = ['forbidden', 'not_found'];

export class Hub {
  constructor({ gladys, fetch, timings, now = Date.now, store }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.store = store ?? new MemoryStore();
    this.config = {
      url: null,
      urlInvalid: false,
      apiToken: '',
      prefixes: [],
      invalidPrefixes: [],
      threshold: 90,
      refreshMinutes: 15,
      language: 'fr',
    };
    this.client = null;
    this.version = null;
    this.summary = null;
    /** null (fine), or the kind of the last failure */
    this.failure = null;
    this.announced = false;
    /** what was already logged once: missing prefixes, refused optional reads */
    this.warned = new Set();
    this.lastStatus = '';
    /** what the triggers already announced: { instance, lastChangeId, high: [prefix ids] } */
    this.notified = null;
    this.configuring = Promise.resolve();
    this.refreshTimer = null;
    this.refreshing = null;
    this.refreshAgain = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.publishFailing = false;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  async start(config) {
    const saved = await this.store.load();
    // A damaged file is a new baseline, not a crash on every read.
    this.notified = typeof saved.instance === 'string' ? saved : null;
    await this.reconfigure(config);
  }

  /** One configuration change at a time: a second one waits for the first. */
  reconfigure(config) {
    const run = this.configuring.then(() => this.#reconfigure(config));
    this.configuring = run.catch(() => {});
    return run;
  }

  async #reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const linkChanged =
      previous.url !== config.url || previous.apiToken !== config.apiToken || !this.client;
    const readChanged =
      linkChanged ||
      previous.prefixes.join() !== config.prefixes.join() ||
      previous.threshold !== config.threshold;
    if (linkChanged || previous.refreshMinutes !== config.refreshMinutes) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (linkChanged) {
      this.client = null;
      this.version = null;
      this.summary = null;
      this.failure = null;
      this.announced = false;
      this.warned.clear();
      if (config.url && config.apiToken) {
        this.client = new NetBoxClient({
          url: config.url,
          token: config.apiToken,
          fetch: this.fetch,
          timeout: this.timings.requestTimeout,
        });
      }
    }
    for (const entry of config.invalidPrefixes) {
      this.#warnOnce(`invalid:${entry}`, `"${entry}" is not a prefix (CIDR) nor a prefix id`);
    }
    if (this.client && !this.refreshTimer) {
      this.refreshTimer = setInterval(
        () => this.refresh().catch((err) => logger.error('Read failed', err)),
        config.refreshMinutes * 60_000,
      );
      this.refreshTimer.unref?.();
    }
    if (readChanged) {
      await this.refresh();
    } else {
      // Language only: same data, new names and texts.
      this.gladys.forgetPublishedStates?.();
      await this.#publishAll();
    }
    await this.updateConnectionStatus();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = '';
    await this.reconfigure(config);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.widgetTimer);
    this.refreshTimer = null;
    // A read under way finishes first, so what it announced is saved.
    await this.refreshing?.catch(() => {});
    await this.store.flush();
  }

  #warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      logger.warn(message);
    }
  }

  // --- Reading NetBox -------------------------------------------------------

  /** Read NetBox (one read at a time; a request during it runs once after). */
  refresh() {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          await this.#refreshOnce();
        } catch (err) {
          // Never ends the loop: a read queued meanwhile (new address) still runs.
          logger.error('Read failed', err);
        }
      } while (this.refreshAgain && !this.stopped);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** A read a token may be refused: null, logged once. */
  async #optional(key, read) {
    try {
      return await read();
    } catch (err) {
      if (!(err instanceof NetBoxError && optionalKinds.includes(err.kind))) {
        throw err;
      }
      this.#warnOnce(`optional:${key}`, `Cannot read the ${key} (${err.message})`);
      return null;
    }
  }

  /** The prefixes an entry of the configuration designates (several VRFs may share a CIDR). */
  async #resolve(client, entry) {
    if (/^\d+$/.test(entry)) {
      try {
        return [await client.get(`/ipam/prefixes/${entry}/`)];
      } catch (err) {
        if (err instanceof NetBoxError && err.kind === 'not_found') {
          return [];
        }
        throw err;
      }
    }
    try {
      const page = await client.page('/ipam/prefixes/', { prefix: entry, limit: '50' });
      return page.results;
    } catch (err) {
      // A CIDR NetBox refuses (400): reported like a missing prefix.
      if (err instanceof NetBoxError && err.kind === 'rejected') {
        return [];
      }
      throw err;
    }
  }

  /** The utilization of one prefix, read like NetBox computes it. */
  async #measure(client, prefix) {
    const cidr = prefix.prefix;
    const vrf = prefix.vrf ? { vrf_id: String(prefix.vrf.id) } : { vrf_id: 'null' };
    if (choice(prefix.status) === 'container') {
      const children = await client.list('/ipam/prefixes/', { within: cidr, ...vrf });
      return utilization(prefix, { childPrefixes: children.map((child) => child.prefix) });
    }
    const [ipCount, ranges] = await Promise.all([
      client.count('/ipam/ip-addresses/', { parent: cidr, ...vrf }),
      client.list('/ipam/ip-ranges/', { parent: cidr, ...vrf }),
    ]);
    return utilization(prefix, { ipCount, ranges });
  }

  async #read(client) {
    if (!this.version) {
      const status = await client.status();
      this.version = String(status?.['netbox-version'] ?? '').trim() || null;
    }
    const count = (path, query) => client.count(path, query);
    const [active, offline, failed, ipAddresses, virtualMachines] = await Promise.all([
      count('/dcim/devices/', { status: 'active' }),
      count('/dcim/devices/', { status: 'offline' }),
      count('/dcim/devices/', { status: 'failed' }),
      count('/ipam/ip-addresses/'),
      this.#optional('virtual machines', () => count('/virtualization/virtual-machines/')),
    ]);
    const changes = await this.#optional('object changes', () =>
      client.changes({ limit: String(RECENT_CHANGES) }),
    );
    // The device changes since the last one seen, every page of them (a bulk
    // edit must not push a creation out of the window); the first read only
    // needs the newest one, as a baseline.
    const known = this.notified?.instance === this.config.url ? this.notified.lastChangeId : null;
    const deviceChanges =
      changes &&
      (Number.isInteger(known)
        ? await client.changes(
            { changed_object_type: 'dcim.device', id__gt: String(known) },
            { all: true },
          )
        : await client.changes({ changed_object_type: 'dcim.device', limit: '1' }));
    const prefixes = [];
    const missing = [];
    const seen = new Set();
    for (const entry of this.config.prefixes) {
      const found = await this.#resolve(client, entry);
      if (found === null || found.length === 0) {
        missing.push(entry);
        this.#warnOnce(`missing:${entry}`, `Prefix ${entry} not found in NetBox`);
        continue;
      }
      this.warned.delete(`missing:${entry}`);
      for (const prefix of found) {
        if (seen.has(prefix.id)) {
          continue;
        }
        seen.add(prefix.id);
        const usage = await this.#measure(client, prefix);
        prefixes.push({
          id: prefix.id,
          cidr: prefix.prefix,
          vrf: prefix.vrf?.name ?? null,
          container: choice(prefix.status) === 'container',
          ...usage,
        });
      }
    }
    return {
      version: this.version,
      devices: { active, offline, failed },
      ipAddresses,
      virtualMachines: virtualMachines ?? 0,
      changes: (changes ?? []).map(parseChange),
      deviceChanges: deviceChanges && deviceChanges.map(parseChange),
      prefixes,
      missing,
    };
  }

  async #refreshOnce() {
    const client = this.client;
    if (this.stopped) {
      return;
    }
    if (!client) {
      await this.#publishAll();
      return;
    }
    let summary;
    try {
      summary = await this.#read(client);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.#fail(err);
      await this.#publishAll();
      await this.updateConnectionStatus();
      return;
    }
    if (client !== this.client || this.stopped) {
      return;
    }
    this.summary = summary;
    this.#recover();
    await this.#publishAll();
    await this.#announce(summary);
    await this.updateConnectionStatus();
  }

  #fail(err) {
    const kind = err instanceof NetBoxError ? err.kind : 'unreachable';
    if (this.failure === null) {
      logger.warn(`NetBox: ${err.message}`);
    } else {
      logger.debug(`NetBox still failing: ${err.message}`);
    }
    this.failure = kind;
    // A new server may answer at the same address: read its version again.
    this.version = null;
  }

  #recover() {
    const { devices, prefixes } = this.summary;
    if (this.failure !== null) {
      logger.info('NetBox answers again');
    } else if (!this.announced) {
      logger.info(
        `Connected to NetBox ${this.version ?? '?'} (${devices.active} active devices, ${prefixes.length} prefixes followed)`,
      );
    }
    this.announced = true;
    this.failure = null;
  }

  // --- Scene events ---------------------------------------------------------

  /**
   * Fire what happened since the last read:
   * - a followed prefix reaches the threshold (again once it went below);
   * - a device created or deleted in NetBox. The first read of a NetBox is a
   *   silent baseline: installing the integration announces no past change.
   */
  async #announce(summary) {
    const instance = this.config.url;
    const known = this.notified?.instance === instance ? this.notified : null;
    const high = new Set(known?.high ?? []);
    const next = { instance, lastChangeId: known?.lastChangeId ?? null, high: [] };

    for (const prefix of summary.prefixes) {
      // Rounded like the state and the widget: 89.6 % is 90 % everywhere.
      if (Math.round(prefix.percent) < this.config.threshold) {
        continue;
      }
      if (high.has(prefix.id)) {
        next.high.push(prefix.id);
        continue;
      }
      try {
        await this.gladys.publishSceneEvent(TRIGGERS.usage, this.#usageEvent(prefix));
        next.high.push(prefix.id);
      } catch (err) {
        // Not recorded: the next read fires it again.
        logger.warn(`Cannot fire ${TRIGGERS.usage}: ${err.message}`);
      }
    }
    // A prefix not read this time (removed from the configuration, deleted)
    // forgets its state.
    next.high.sort((a, b) => a - b);

    const changes = summary.deviceChanges;
    if (changes) {
      const newest = changes.reduce((max, change) => Math.max(max, change.id), 0);
      if (next.lastChangeId === null) {
        next.lastChangeId = newest;
      } else {
        const fresh = changes
          .filter(
            (change) =>
              change.id > next.lastChangeId &&
              change.type === 'dcim.device' &&
              ['create', 'delete'].includes(change.action),
          )
          .sort((a, b) => a.id - b.id);
        if (fresh.length > MAX_EVENTS_PER_READ) {
          logger.info(`${fresh.length} device changes at once: ${MAX_EVENTS_PER_READ} announced`);
        }
        let reached = Math.max(next.lastChangeId, newest);
        for (const change of fresh.slice(0, MAX_EVENTS_PER_READ)) {
          if (this.stopped) {
            return;
          }
          try {
            await this.gladys.publishSceneEvent(TRIGGERS.device, this.#deviceEvent(change));
          } catch (err) {
            // Stop there: this change and the next ones fire on the next read.
            logger.warn(`Cannot fire ${TRIGGERS.device}: ${err.message}`);
            reached = change.id - 1;
            break;
          }
        }
        next.lastChangeId = reached;
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(this.notified)) {
      this.notified = next;
      await this.store.save(next);
    }
  }

  #usageEvent(prefix) {
    logger.debug(`Prefix ${prefix.cidr} at ${prefix.percent} %`);
    return {
      device: prefixIds(this.gladys, prefix.id).device,
      prefix: prefix.cidr,
      vrf: prefix.vrf ?? '',
      utilization: Math.round(prefix.percent),
      free_addresses: prefix.free > BigInt(MAX_ADDRESSES) ? MAX_ADDRESSES : Number(prefix.free),
      threshold: this.config.threshold,
    };
  }

  #deviceEvent(change) {
    logger.debug(`Device change ${change.id}: ${change.action} ${change.name}`);
    const actions = ACTIONS[this.language] ?? ACTIONS.en;
    return {
      action: change.action,
      action_text: actions[change.action],
      device: change.name,
      device_id: change.objectId,
      user: change.user,
      time: change.time,
    };
  }

  // --- Devices and states ---------------------------------------------------

  #isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  buildDevices() {
    if (!this.summary) {
      return [];
    }
    return [
      buildInstance(this.gladys, this.language, this.config.url ?? '', this.summary.version),
      ...this.summary.prefixes.map((prefix) => buildPrefix(this.gladys, this.language, prefix)),
    ];
  }

  async #publishAll() {
    await this.publishDevices();
    await this.publishStates();
    this.refreshWidget();
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  /**
   * The states of the devices the user added (Gladys drops the others).
   * @param {string} [force] external id of a device just created
   */
  async publishStates(force) {
    // Without a summary (NetBox down since the start), `reachable` alone.
    if (this.stopped || (!this.summary && this.failure === null)) {
      return;
    }
    const reachable = this.failure === null;
    const states = buildStates(this.gladys, this.summary, this.language, reachable).filter(
      (state) => {
        const device = state.device_feature_external_id.split(':').slice(0, -1).join(':');
        return device === force || this.#isCreated(device);
      },
    );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat });
    } catch (err) {
      if (this.publishFailing) {
        logger.debug(`Cannot publish the states: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the states: ${err.message}`);
      }
      this.publishFailing = true;
      return;
    }
    if (this.publishFailing) {
      logger.info('States published again');
    }
    this.publishFailing = false;
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!deviceKind(this.gladys, device?.external_id)) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.publishStates(device.external_id);
    this.refreshWidget();
  }

  /** onPoll (the devices are not polled: the container reads on its timer). */
  async poll(device) {
    if (deviceKind(this.gladys, device?.external_id)) {
      this.gladys.forgetPublishedStates?.(device.external_id);
      await this.publishStates(device.external_id);
    }
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + this.timings.widgetGap - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Connection status ----------------------------------------------------

  statusKey() {
    if (this.config.urlInvalid) {
      return 'invalid';
    }
    if (!this.config.url) {
      return 'none';
    }
    if (!this.config.apiToken) {
      return 'token';
    }
    if (this.failure) {
      return (
        {
          unauthorized: 'unauthorized',
          forbidden: 'forbidden',
          invalid: 'invalid_answer',
          not_found: 'invalid_answer',
        }[this.failure] ?? 'unreachable'
      );
    }
    return null;
  }

  statusMessage() {
    const key = this.statusKey();
    if (!key) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(STATUS_TEXT).map(([language, table]) => [language, table[key]]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    // Nothing to say before the first answer or failure.
    if (this.client && !this.summary && this.failure === null) {
      return;
    }
    const message = this.statusMessage();
    const connected = Boolean(this.client) && this.summary !== null && this.failure === null;
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Actions --------------------------------------------------------------

  /** "Test the connection": a fresh read, then its outcome (a failure is red). */
  async testReport() {
    if (!this.client) {
      throw new ActionFailure(this.statusMessage());
    }
    await this.refresh();
    const message = this.statusMessage();
    if (message) {
      throw new ActionFailure(message);
    }
    if (!this.summary) {
      throw new ActionFailure(commandMessage('unreachable'));
    }
    const { devices, prefixes, missing } = this.summary;
    logger.info('Connection test: NetBox answers');
    return Object.fromEntries(
      Object.entries(TEST_TEXT).map(([language, render]) => [
        language,
        render(this.version ?? '?', devices.active, prefixes.length, missing),
      ]),
    );
  }

  /** The NetBox device a scene names: by name (case-insensitive), or by number. */
  async #findDevice(client, wanted) {
    if (/^\d+$/.test(wanted)) {
      try {
        return await client.get(`/dcim/devices/${wanted}/`);
      } catch (err) {
        if (!(err instanceof NetBoxError && err.kind === 'not_found')) {
          throw err;
        }
      }
    }
    const page = await client.page('/dcim/devices/', { name__ie: wanted, limit: '2', brief: '1' });
    if (page.results.length === 0) {
      throw new ActionFailure(commandMessage('device_not_found'));
    }
    if (page.results.length > 1) {
      throw new ActionFailure(commandMessage('device_ambiguous'));
    }
    return page.results[0];
  }

  /**
   * The scene action: a journal entry on a NetBox device.
   * @param {{ device?: string, kind?: string, comments?: string }} fields
   */
  async addJournalEntry(fields = {}) {
    const client = this.client;
    if (!client) {
      throw new ActionFailure(commandMessage('not_configured'));
    }
    const wanted = String(fields.device ?? '').trim();
    const comments = String(fields.comments ?? '').trim();
    if (!wanted) {
      throw new ActionFailure(commandMessage('no_device'));
    }
    if (!comments) {
      throw new ActionFailure(commandMessage('no_comments'));
    }
    const kind = JOURNAL_KINDS.includes(fields.kind) ? fields.kind : 'info';
    try {
      const device = await this.#findDevice(client, wanted);
      const entry = await client.createJournalEntry({
        assigned_object_type: 'dcim.device',
        assigned_object_id: device.id,
        kind,
        comments: comments.slice(0, 10_000),
      });
      logger.info(`Journal entry ${entry?.id} added to device ${device.id}`);
      return {
        entry_id: Number(entry?.id) || 0,
        device: String(device.name ?? device.display ?? ''),
      };
    } catch (err) {
      if (err instanceof ActionFailure) {
        throw err;
      }
      logger.warn(`Cannot add the journal entry: ${err.message}`);
      if (err instanceof NetBoxError && ['forbidden', 'unauthorized'].includes(err.kind)) {
        throw new ActionFailure(commandMessage('forbidden'));
      }
      if (err instanceof NetBoxError && err.kind === 'rejected') {
        const messages = commandMessage('rejected');
        const detail = err.message.replace(/^POST [^:]+: /, '').slice(0, 120);
        throw new ActionFailure(
          Object.fromEntries(
            Object.entries(messages).map(([language, text]) => [language, `${text} ${detail}`]),
          ),
        );
      }
      throw new ActionFailure(commandMessage('unreachable'));
    }
  }

  /** The name the user gave the prefix device in Gladys, or its CIDR (and VRF). */
  prefixName(prefix) {
    const externalId = prefixIds(this.gladys, prefix.id).device;
    const device = (this.gladys.devices ?? []).find((item) => item.external_id === externalId);
    return device?.name || prefixLabel(prefix);
  }

  /** What the widget shows, or null before the first read. */
  widgetData() {
    if (!this.summary) {
      return null;
    }
    return {
      summary: this.summary,
      reachable: this.failure === null,
      threshold: this.config.threshold,
    };
  }
}
