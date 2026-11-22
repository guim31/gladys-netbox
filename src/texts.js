// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// -----------------------------------------------------------------------------

// Feature names (frozen by Gladys at creation).
export const NAMES = {
  en: {
    reachable: 'NetBox reachable',
    version: 'NetBox version',
    devices_active: 'Active devices',
    devices_offline: 'Offline devices',
    devices_failed: 'Failed devices',
    ip_addresses: 'IP addresses',
    virtual_machines: 'Virtual machines',
    last_change: 'Last change',
    utilization: 'Utilization',
    free_addresses: 'Free addresses',
  },
  fr: {
    reachable: 'NetBox joignable',
    version: 'Version de NetBox',
    devices_active: 'Équipements actifs',
    devices_offline: 'Équipements hors ligne',
    devices_failed: 'Équipements en panne',
    ip_addresses: 'Adresses IP',
    virtual_machines: 'Machines virtuelles',
    last_change: 'Dernier changement',
    utilization: "Taux d'occupation",
    free_addresses: 'Adresses libres',
  },
  de: {
    reachable: 'NetBox erreichbar',
    version: 'NetBox-Version',
    devices_active: 'Aktive Geräte',
    devices_offline: 'Offline-Geräte',
    devices_failed: 'Defekte Geräte',
    ip_addresses: 'IP-Adressen',
    virtual_machines: 'Virtuelle Maschinen',
    last_change: 'Letzte Änderung',
    utilization: 'Auslastung',
    free_addresses: 'Freie Adressen',
  },
  es: {
    reachable: 'NetBox accesible',
    version: 'Versión de NetBox',
    devices_active: 'Dispositivos activos',
    devices_offline: 'Dispositivos sin conexión',
    devices_failed: 'Dispositivos averiados',
    ip_addresses: 'Direcciones IP',
    virtual_machines: 'Máquinas virtuales',
    last_change: 'Último cambio',
    utilization: 'Ocupación',
    free_addresses: 'Direcciones libres',
  },
};

// The device of a followed prefix: "Prefix 192.0.2.0/24 (VRF)".
export const PREFIX_NAME = { en: 'Prefix', fr: 'Préfixe', de: 'Präfix', es: 'Prefijo' };

// The text feature when NetBox has no change yet.
export const NONE = { en: 'None', fr: 'Aucun', de: 'Keine', es: 'Ninguno' };

// What an object change did (feature text, widget, trigger variable).
export const ACTIONS = {
  en: { create: 'Created', update: 'Updated', delete: 'Deleted' },
  fr: { create: 'Création', update: 'Modification', delete: 'Suppression' },
  de: { create: 'Erstellt', update: 'Geändert', delete: 'Gelöscht' },
  es: { create: 'Creación', update: 'Modificación', delete: 'Eliminación' },
};

export const INIT_FAILED = {
  en: 'The integration could not start: see its logs.',
  fr: "L'intégration n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die Integration konnte nicht starten: sieh dir ihre Protokolle an.',
  es: 'La integración no pudo iniciarse: consulte sus registros.',
};

// The connection status shown in the Configuration screen.
export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of NetBox.',
    invalid: 'The NetBox address is not valid (http or https, without user name in it).',
    token: 'Enter a NetBox API token.',
    unreachable: 'NetBox does not answer: check its address and that it is running.',
    unauthorized: 'Token refused: check the API token (it may have expired).',
    forbidden: 'This token may not read the devices or the IP addresses (permissions).',
    invalid_answer: 'This address does not answer like NetBox (a proxy login page?).',
  },
  fr: {
    none: "Saisissez l'adresse de NetBox.",
    invalid: "L'adresse de NetBox n'est pas valide (http ou https, sans nom d'utilisateur dedans).",
    token: "Saisissez un jeton d'API NetBox.",
    unreachable: "NetBox ne répond pas : vérifiez son adresse et qu'il est démarré.",
    unauthorized: "Jeton refusé : vérifiez le jeton d'API (il a peut-être expiré).",
    forbidden: 'Ce jeton ne peut pas lire les équipements ou les adresses IP (droits).',
    invalid_answer: "Cette adresse ne répond pas comme NetBox (page de connexion d'un proxy ?).",
  },
  de: {
    none: 'Gib die Adresse von NetBox ein.',
    invalid: 'Die NetBox-Adresse ist ungültig (http oder https, ohne Benutzername darin).',
    token: 'Gib ein NetBox-API-Token ein.',
    unreachable: 'NetBox antwortet nicht: prüfe die Adresse und ob es läuft.',
    unauthorized: 'Token abgelehnt: prüfe das API-Token (es ist vielleicht abgelaufen).',
    forbidden: 'Dieses Token darf die Geräte oder die IP-Adressen nicht lesen (Rechte).',
    invalid_answer: 'Diese Adresse antwortet nicht wie NetBox (Anmeldeseite eines Proxys?).',
  },
  es: {
    none: 'Introduzca la dirección de NetBox.',
    invalid: 'La dirección de NetBox no es válida (http o https, sin nombre de usuario).',
    token: 'Introduzca un token de API de NetBox.',
    unreachable: 'NetBox no responde: compruebe su dirección y que esté en marcha.',
    unauthorized: 'Token rechazado: compruebe el token de API (puede haber caducado).',
    forbidden: 'Este token no puede leer los dispositivos ni las direcciones IP (permisos).',
    invalid_answer: 'Esta dirección no responde como NetBox (¿página de acceso de un proxy?).',
  },
};

// The "Test the connection" action. `missing`: the prefixes not found.
export const TEST_TEXT = {
  en: (version, devices, prefixes, missing) =>
    `NetBox ${version} answers: ${devices} active device(s), ${prefixes} prefix(es) followed.` +
    (missing.length ? ` Not found: ${missing.join(', ')}.` : ''),
  fr: (version, devices, prefixes, missing) =>
    `NetBox ${version} répond : ${devices} équipement(s) actif(s), ${prefixes} préfixe(s) suivi(s).` +
    (missing.length ? ` Introuvable(s) : ${missing.join(', ')}.` : ''),
  de: (version, devices, prefixes, missing) =>
    `NetBox ${version} antwortet. Aktive Geräte: ${devices}, verfolgte Präfixe: ${prefixes}.` +
    (missing.length ? ` Nicht gefunden: ${missing.join(', ')}.` : ''),
  es: (version, devices, prefixes, missing) =>
    `NetBox ${version} responde: ${devices} dispositivo(s) activo(s), ${prefixes} prefijo(s) seguido(s).` +
    (missing.length ? ` No encontrado(s): ${missing.join(', ')}.` : ''),
};

// Failures of the actions (shown in red by Gladys) and the journal entry.
export const COMMAND_ERRORS = {
  en: {
    unreachable: 'NetBox could not be read: see the status in the configuration.',
    not_configured: 'Enter the address of NetBox and an API token first.',
    no_device: 'Enter the name of a NetBox device.',
    no_comments: 'Enter the text of the journal entry.',
    device_not_found: 'No NetBox device has this name.',
    device_ambiguous: 'Several NetBox devices have this name: give its number instead.',
    forbidden: 'This token may not add journal entries (permissions, or a read-only token).',
    rejected: 'NetBox refused the journal entry.',
  },
  fr: {
    unreachable: "NetBox n'a pas pu être lu : voyez l'état dans la configuration.",
    not_configured: "Saisissez d'abord l'adresse de NetBox et un jeton d'API.",
    no_device: "Saisissez le nom d'un équipement NetBox.",
    no_comments: "Saisissez le texte de l'entrée de journal.",
    device_not_found: "Aucun équipement NetBox n'a ce nom.",
    device_ambiguous: 'Plusieurs équipements NetBox ont ce nom : donnez plutôt son numéro.',
    forbidden:
      "Ce jeton ne peut pas ajouter d'entrée de journal (droits, ou jeton en lecture seule).",
    rejected: "NetBox a refusé l'entrée de journal.",
  },
  de: {
    unreachable: 'NetBox konnte nicht gelesen werden: sieh dir den Status in der Konfiguration an.',
    not_configured: 'Gib zuerst die Adresse von NetBox und ein API-Token ein.',
    no_device: 'Gib den Namen eines NetBox-Geräts ein.',
    no_comments: 'Gib den Text des Journaleintrags ein.',
    device_not_found: 'Kein NetBox-Gerät hat diesen Namen.',
    device_ambiguous: 'Mehrere NetBox-Geräte haben diesen Namen: gib stattdessen seine Nummer an.',
    forbidden:
      'Dieses Token darf keine Journaleinträge hinzufügen (Rechte, oder schreibgeschütztes Token).',
    rejected: 'NetBox hat den Journaleintrag abgelehnt.',
  },
  es: {
    unreachable: 'No se pudo leer NetBox: consulte el estado en la configuración.',
    not_configured: 'Introduzca primero la dirección de NetBox y un token de API.',
    no_device: 'Introduzca el nombre de un dispositivo de NetBox.',
    no_comments: 'Introduzca el texto de la entrada del diario.',
    device_not_found: 'Ningún dispositivo de NetBox tiene este nombre.',
    device_ambiguous: 'Varios dispositivos de NetBox tienen este nombre: indique su número.',
    forbidden: 'Este token no puede añadir entradas al diario (permisos, o token de solo lectura).',
    rejected: 'NetBox rechazó la entrada del diario.',
  },
};

/** { en, fr, de, es } of a coded command error. */
export function commandMessage(code) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [language, table[code]]),
  );
}

/**
 * An action failure: Gladys shows the multi-language message in red.
 * (A handler that returns is shown in green.)
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

/** "Création · sw-paris-01 · admin" */
export function describeChange(change, language) {
  const actions = ACTIONS[language] ?? ACTIONS.en;
  const parts = [actions[change.action] ?? change.action, change.name];
  if (change.user) {
    parts.push(change.user);
  }
  return parts.join(' · ');
}

/** "192.0.2.0/24" or "192.0.2.0/24 (Office)" with its VRF. */
export const prefixLabel = (prefix) =>
  prefix.vrf ? `${prefix.cidr} (${prefix.vrf})` : prefix.cidr;
