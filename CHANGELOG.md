# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-22

### Added

- A NetBox device: reachable, version, active, offline and failed devices, IP
  addresses, virtual machines and the last change of the log.
- A device per followed prefix (CIDR or NetBox number): utilization, computed
  like NetBox, and free addresses.
- The "NetBox" dashboard widget: devices, IP addresses, virtual machines, the
  fullest prefixes and the last changes.
- Scene triggers "Prefix almost full" and "Device created or deleted".
- Scene action "Add a NetBox journal entry".
- v1 and v2 (`nbt_…`) API tokens; NetBox 3.7 to 4.x (tested on 4.7.5).
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-netbox/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-netbox/releases/tag/v1.0.0
