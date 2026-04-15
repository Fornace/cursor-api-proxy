# Changelog

All notable changes to this project will be documented in this file.

## [0.7.2] — 2026-04-15

Fork of [cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) 0.7.1 with keychain and Node.js fixes.

### Fixed
- **macOS keychain popup suppressed** — `readKeychainToken()` returns `undefined` directly, avoiding the `security` execSync call that triggers the keychain dialog. The token is not needed since `cursor-agent` handles its own auth.
- **`CURSOR_SKIP_KEYCHAIN=1` always injected** into every spawned agent process (sync, streaming, and ACP), ensuring the underlying Cursor CLI never triggers the keychain popup regardless of parent environment.
- **`CURSOR_AGENT_NODE`/`CURSOR_AGENT_SCRIPT` on all platforms** — previously Windows-only; now available on macOS too to override the agent's bundled Node.js and avoid segfaults with `--list-models` on some installs.
