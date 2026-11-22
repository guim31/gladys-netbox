# NetBox for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[NetBox](https://netboxlabs.com/oss/netbox/), the open-source network source
of truth: follow your devices by status, IP addresses and virtual machines,
the utilization of the prefixes you choose and the change log, react to them
in scenes, and write journal entries from scenes. Local only.

Tested against a real NetBox 4.7.5 server (official `netbox-docker` image).

## Features

- **A NetBox device**: reachable, version, active, offline and failed
  devices, IP addresses, virtual machines, and the last change of the log.
- **A device per followed prefix**: utilization (computed like the NetBox
  prefix page: IP addresses and utilized ranges, child prefixes for a
  container) and free addresses.
- **Dashboard widget** "NetBox": four tiles, and the fullest prefixes or the
  last changes.
- **Scene triggers**: "Prefix almost full" (a threshold you set, 90 % by
  default) and "Device created or deleted", remembered across restarts.
- **Scene action** "Add a NetBox journal entry" on a device given by its name
  or number, with a kind (info, success, warning, danger) and a text that
  accepts scene variables.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- NetBox 3.7 to 4.x reachable from Gladys (tested on 4.7.5).
- An API token (NetBox → your profile → API Tokens): a v1 token or a v2
  token (`nbt_…`, NetBox 4.5+). Read-only is enough, except for the journal
  entries.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-netbox` (or find **NetBox** in the
   catalog).
2. In **Configuration**, enter the address of NetBox, the API token and the
   prefixes to follow. Save, then **Test the connection**.
3. Add the **NetBox** device and the prefixes from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

NetBox pushes nothing: the container reads its REST API every 15 minutes by
default (5 to 60): counts with `limit=1` (devices by status, IP addresses,
virtual machines), the last object changes (`/api/core/object-changes/`, or
`/api/extras/object-changes/` before NetBox 4.1), and for each followed
prefix its IP addresses and ranges, or its child prefixes. The devices are
published with `should_poll: false`; only changed states are sent to Gladys,
with a heartbeat every 6 hours. The only write is the journal entry of the
scene action.

## Limitations

- One NetBox server per integration, 20 followed prefixes at most.
- The triggers fire at the first read after the change; the first read after
  the installation announces no past change.
- An IP address declared inside a range marked as utilized is counted twice
  (NetBox 4.7 counts it once): the utilization is capped at 100 %.
- Tested on NetBox 4.7.5 only; 3.7 to 4.6 share the API but were not tested
  on a real server: feedback welcome.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and a fake NetBox answering with
objects recorded on a real NetBox 4.7.5 server (`test/fixtures/netbox/`,
demo data on documentation addresses).

## Credits

- [NetBox](https://github.com/netbox-community/netbox), by NetBox Labs and
  the community (Apache-2.0): this integration only talks to its REST API.
- The utilization follows `Prefix.get_utilization()` of NetBox.
- The cover shows the official NetBox logo, taken from the
  [NetBox repository](https://github.com/netbox-community/netbox/tree/main/docs/netbox_logo_dark.svg).
  NetBox is a trademark of NetBox Labs, Inc.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by NetBox Labs or
the NetBox project.

## License

Apache-2.0, see [`LICENSE`](LICENSE).
