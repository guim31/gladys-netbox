// -----------------------------------------------------------------------------
// The "NetBox" dashboard widget: tiles (active devices, devices offline or
// failed, IP addresses, virtual machines), and one list (the core allows one
// per widget): the followed prefixes with their utilization (default), the
// last changes, or none.
// Read only: no button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ACTIONS, prefixLabel } from './texts.js';

export const MAX_ITEMS = 6;
// The `list` setting of the widget.
export const LISTS = ['prefixes', 'changes', 'none'];

export const TEXT = {
  active: { en: 'Active', fr: 'Actifs', de: 'Aktiv', es: 'Activos' },
  problems: {
    en: 'Offline or failed',
    fr: 'Hors ligne / panne',
    de: 'Offline / defekt',
    es: 'Sin conexión / avería',
  },
  ips: { en: 'IP addresses', fr: 'Adresses IP', de: 'IP-Adressen', es: 'Direcciones IP' },
  vms: { en: 'VMs', fr: 'VM', de: 'VMs', es: 'VM' },
  free: { en: 'free', fr: 'libres', de: 'frei', es: 'libres' },
  waiting: {
    en: 'Waiting for NetBox: check the configuration of the integration.',
    fr: "En attente de NetBox : vérifiez la configuration de l'intégration.",
    de: 'Warte auf NetBox: prüfe die Konfiguration der Integration.',
    es: 'Esperando a NetBox: compruebe la configuración de la integración.',
  },
  unreachable: {
    en: 'NetBox does not answer: last values read.',
    fr: 'NetBox ne répond pas : dernières valeurs lues.',
    de: 'NetBox antwortet nicht: zuletzt gelesene Werte.',
    es: 'NetBox no responde: últimos valores leídos.',
  },
};

const pick = (table, language) => table[language] ?? table.en;
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formatCount = (value, language) =>
  new Intl.NumberFormat(LOCALES[language] ?? LOCALES.en).format(value);

/**
 * The card-list rows of the followed prefixes, the fullest first.
 * @param {(prefix: object) => string} nameOf the name given in Gladys, or the CIDR
 */
export function prefixItems(prefixes, threshold, language, nameOf = prefixLabel) {
  return [...prefixes]
    .sort((a, b) => b.percent - a.percent)
    .slice(0, MAX_ITEMS)
    .map((prefix) => {
      const percent = Math.round(prefix.percent);
      const color =
        percent >= threshold
          ? WIDGET_COLORS.DANGER
          : percent >= threshold - 10
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS;
      const free = prefix.free > 999_999_999n ? '∞' : formatCount(Number(prefix.free), language);
      return {
        title: cut(nameOf(prefix), 60),
        subtitle: `${free} ${pick(TEXT.free, language)}`,
        badge: { text: `${percent} %`, color },
      };
    });
}

const CHANGE_COLORS = {
  create: WIDGET_COLORS.SUCCESS,
  update: WIDGET_COLORS.INFO,
  delete: WIDGET_COLORS.DANGER,
};

/** The card-list rows of the last changes (the date replaces the subtitle). */
export function changeItems(changes, language) {
  const actions = ACTIONS[language] ?? ACTIONS.en;
  return changes.slice(0, MAX_ITEMS).map((change) => ({
    title: cut(change.user ? `${change.name} · ${change.user}` : change.name, 60),
    subtitle: change.type,
    ...(change.time ? { date: change.time } : {}),
    badge: {
      text: cut(actions[change.action] ?? change.action, 16),
      color: CHANGE_COLORS[change.action] ?? WIDGET_COLORS.INFO,
    },
  }));
}

export function buildContent(hub, { language = 'en', settings = {} } = {}) {
  const data = hub.widgetData();
  if (!data) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.waiting, language) }],
    };
  }
  const { summary, reachable, threshold } = data;
  const problems = summary.devices.offline + summary.devices.failed;
  const components = [
    ...(reachable
      ? []
      : [{ type: 'text', variant: 'caption', text: pick(TEXT.unreachable, language) }]),
    {
      type: 'value',
      label: pick(TEXT.active, language),
      value: summary.devices.active,
      icon: 'server',
    },
    {
      type: 'value',
      label: pick(TEXT.problems, language),
      value: problems,
      icon: 'alert-triangle',
      color: problems > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    { type: 'value', label: pick(TEXT.ips, language), value: summary.ipAddresses, icon: 'globe' },
    {
      type: 'value',
      label: pick(TEXT.vms, language),
      value: summary.virtualMachines,
      icon: 'layers',
    },
  ];
  const list = LISTS.includes(settings.list) ? settings.list : 'prefixes';
  if (list === 'prefixes' && summary.prefixes.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: prefixItems(summary.prefixes, threshold, language, (prefix) => hub.prefixName(prefix)),
    });
  }
  if (list === 'changes' && summary.changes.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: changeItems(summary.changes, language),
    });
  }
  // The hub nudges the widget after every read.
  return { ttl_seconds: 900, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildContent(hub, request),
  },
};
