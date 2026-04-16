import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

/**
 * CJS preload script that intercepts /usr/bin/security calls.
 * Embedded as a string so it works without extra build/copy steps.
 */
const SHIM_SOURCE = `"use strict";
if (process.env.CURSOR_ALLOW_KEYCHAIN === "1") return;
if (process.platform !== "darwin") return;
var cp = require("node:child_process");
var EE = require("node:events").EventEmitter;
var Readable = require("node:stream").Readable;
var _spawn = cp.spawn;
var _efs = cp.execFileSync;
function isSec(c) { return c === "/usr/bin/security" || (typeof c === "string" && c.endsWith("/security")); }
function act(a) { return Array.isArray(a) && a.length > 0 ? String(a[0]) : ""; }
cp.spawn = function(cmd, args, opts) {
  if (!isSec(cmd)) return _spawn.apply(this, arguments);
  var code = act(args).startsWith("find-") ? 44 : 0;
  var ch = new EE();
  ch.pid = 99999; ch.stdin = null; ch.kill = function(){}; ch.ref = function(){return ch}; ch.unref = function(){return ch};
  ch.stdout = new Readable({ read: function(){} });
  ch.stderr = new Readable({ read: function(){} });
  setImmediate(function() { ch.stdout.push(null); ch.stderr.push(null); ch.emit("close", code, null); });
  return ch;
};
cp.execFileSync = function(cmd, args, opts) {
  if (!isSec(cmd)) return _efs.apply(this, arguments);
  if (act(args).startsWith("find-")) { var e = new Error("not found"); e.status = 44; e.code = 44; throw e; }
  return Buffer.from("");
};
`;

let shimPath: string | null = null;

function ensureShim(): string {
  if (shimPath && existsSync(shimPath)) return shimPath;

  // Write to a persistent location so it survives across requests
  const dir = join(homedir(), ".cursor-api-proxy");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const p = join(dir, "keychain-shim.cjs");
  try {
    writeFileSync(p, SHIM_SOURCE, { encoding: "utf-8", mode: 0o644 });
    shimPath = p;
    return p;
  } catch {
    // Fallback to tmpdir
    const tmp = join(tmpdir(), "cursor-keychain-shim.cjs");
    writeFileSync(tmp, SHIM_SOURCE, { encoding: "utf-8", mode: 0o644 });
    shimPath = tmp;
    return tmp;
  }
}

/**
 * Prepend `--require <shim>` to an existing NODE_OPTIONS value.
 * Skips if CURSOR_ALLOW_KEYCHAIN=1 or non-darwin.
 */
export function keychainShimNodeOptions(
  existing?: string | undefined,
): string {
  if (process.env.CURSOR_ALLOW_KEYCHAIN === "1") return existing ?? "";
  if (process.platform !== "darwin") return existing ?? "";
  const path = ensureShim();
  const flag = `--require ${path}`;
  if (existing && existing.includes("keychain-shim")) return existing;
  return existing ? `${flag} ${existing}` : flag;
}
