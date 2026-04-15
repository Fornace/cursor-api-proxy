import * as fs from "node:fs";
import * as path from "node:path";

/** Token file written per-account after each agent run */
export const TOKEN_FILE = ".cursor-token";

export function readCachedToken(configDir: string): string | undefined {
  try {
    const p = path.join(configDir, TOKEN_FILE);
    if (fs.existsSync(p))
      return fs.readFileSync(p, "utf-8").trim() || undefined;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function writeCachedToken(configDir: string, token: string): void {
  try {
    fs.writeFileSync(path.join(configDir, TOKEN_FILE), token, {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Read the shared macOS Keychain slot used by the Cursor CLI.
 * Skipped — keychain reads trigger unwanted popups and are not needed
 * for auth (the cursor-agent subprocess handles its own authentication).
 */
export function readKeychainToken(): string | undefined {
  return undefined;
}
