# Changelog

All notable changes to **Geektastic Realms Foundry Connect** will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.1.0] - 2026-07-01

### Added
- **Stage 2 — connection handshake.** World-scoped settings for the Geektastic Realms
  **Server URL** and **API Token**. A **Test Connection** settings menu opens a small
  dialog that calls `GET {url}/api/foundry/v1/ping` with the configured Bearer token and
  reports success (connected world name + Geektastic Realms version) or the specific
  failure reason (missing settings, network error, invalid/revoked token, non-2xx
  response).
- Verified against Foundry VTT v13. Not yet tested against v14.

[Unreleased]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Geektasticdad/geektastic-realms-foundryvtt/releases/tag/v0.1.0
