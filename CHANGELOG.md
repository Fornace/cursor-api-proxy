# Changelog

All notable changes to this project will be documented in this file.

## [0.7.4] — 2026-04-15

### Fixed
- **ACP keychain guard** — `buildAcpSpawnEnv` no longer copies `CURSOR_SKIP_KEYCHAIN` from the parent `process.env`, which could overwrite the forced `"1"` (e.g. parent had `0` or empty). The skip flag is now applied last so it cannot be disabled by config or environment.
- **`acpEnv` and CLI entry** — bridge config always sets `CURSOR_SKIP_KEYCHAIN=1` on `acpEnv`; the CLI sets it at process start; the programmatic `client` proxy spawner injects it for the child.

## [0.7.3] — 2026-04-15

### Changed
- Renamed package to `cursor-composer-in-claude` for npm publishing.

## [0.7.2] — 2026-04-15

Fork of [cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) 0.7.1 with keychain and Node.js fixes.

### Fixed
- **macOS keychain popup suppressed** — `readKeychainToken()` returns `undefined` directly, avoiding the `security` execSync call that triggers the keychain dialog. The token is not needed since `cursor-agent` handles its own auth.
- **`CURSOR_SKIP_KEYCHAIN=1` always injected** into every spawned agent process (sync, streaming, and ACP), ensuring the underlying Cursor CLI never triggers the keychain popup regardless of parent environment.
- **`CURSOR_AGENT_NODE`/`CURSOR_AGENT_SCRIPT` on all platforms** — previously Windows-only; now available on macOS too to override the agent's bundled Node.js and avoid segfaults with `--list-models` on some installs.
