export type ParsedArgs = {
  tailscale: boolean;
  help: boolean;
  login: boolean;
  accountsList: boolean;
  logout: boolean;
  accountName: string;
  proxies: string[];
  resetHwid: boolean;
  deepClean: boolean;
  dryRun: boolean;
  port?: number;
  host?: string;
  configDirs: string[];
  multiPort: boolean;
};

function parseValue(arg: string, prefix: string, argv: string[], i: number): { value: string; nextIndex: number } {
  if (arg.startsWith(`${prefix}=`)) {
    return { value: arg.slice(prefix.length + 1), nextIndex: i };
  }
  const next = argv[i + 1];
  if (next == null || next.startsWith("-")) {
    throw new Error(`Missing value for ${prefix}`);
  }
  return { value: next, nextIndex: i + 1 };
}

export function parseArgs(argv: string[]): ParsedArgs {
  let tailscale = false;
  let help = false;
  let login = false;
  let accountsList = false;
  let logout = false;
  let accountName = "";
  let proxies: string[] = [];
  let resetHwid = false;
  let deepClean = false;
  let dryRun = false;
  let port: number | undefined;
  let host: string | undefined;
  const configDirs: string[] = [];
  let multiPort = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "login" || arg === "add-account") {
      login = true;
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        accountName = argv[++i];
      }
      continue;
    }

    if (arg === "logout" || arg === "remove-account") {
      logout = true;
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        accountName = argv[++i];
      }
      continue;
    }

    if (arg === "accounts" || arg === "list-accounts") {
      accountsList = true;
      continue;
    }

    if (arg === "reset-hwid" || arg === "reset") {
      resetHwid = true;
      continue;
    }

    if (arg === "--deep-clean") {
      deepClean = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--tailscale") {
      tailscale = true;
      continue;
    }

    if (arg === "--multi-port") {
      multiPort = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--port" || arg.startsWith("--port=")) {
      const { value, nextIndex } = parseValue(arg, "--port", argv, i);
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 65535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      port = n;
      i = nextIndex;
      continue;
    }

    if (arg === "--host" || arg.startsWith("--host=")) {
      const { value, nextIndex } = parseValue(arg, "--host", argv, i);
      host = value;
      i = nextIndex;
      continue;
    }

    if (arg === "--config-dir" || arg.startsWith("--config-dir=")) {
      const { value, nextIndex } = parseValue(arg, "--config-dir", argv, i);
      configDirs.push(value);
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--proxy=")) {
      proxies = arg
        .slice("--proxy=".length)
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    tailscale,
    help,
    login,
    accountsList,
    logout,
    accountName,
    proxies,
    resetHwid,
    deepClean,
    dryRun,
    port,
    host,
    configDirs,
    multiPort,
  };
}

export function printHelp(version: string): void {
  console.log(`cursor-api-proxy v${version}`);
  console.log("");
  console.log("Usage:");
  console.log("  cursor-api-proxy [options]");
  console.log("");
  console.log("Commands:");
  console.log(
    "  login [name]              Log into a Cursor account (saved to ~/.cursor-api-proxy/accounts/)",
  );
  console.log(
    "  login [name] --proxy=...  Same, but open Chrome through a random proxy from a comma-separated list",
  );
  console.log("  logout <name>             Remove a saved Cursor account");
  console.log("  accounts                  List saved accounts with plan info");
  console.log(
    "  reset-hwid                Reset Cursor machine/telemetry IDs (anti-ban)",
  );
  console.log(
    "  reset-hwid --deep-clean   Also wipe session storage and cookies",
  );
  console.log("");
  console.log("Options:");
  console.log("  --port <n>           Listen port (default 8765, env: CURSOR_BRIDGE_PORT)");
  console.log("  --host <h>           Listen host (env: CURSOR_BRIDGE_HOST)");
  console.log("  --config-dir <path>  Cursor config dir to use (repeat for account pool)");
  console.log("  --multi-port         With multiple --config-dir, spawn one server per dir on port, port+1, …");
  console.log("  --tailscale          Bind to 0.0.0.0 for tailnet/LAN access");
  console.log("  -h, --help           Show this help message");
}
