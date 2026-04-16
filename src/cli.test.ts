import { describe, it, expect } from "vitest";

import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  const base = {
    resetHwid: false,
    deepClean: false,
    dryRun: false,
    port: undefined,
    host: undefined,
    configDirs: [],
    multiPort: false,
  };

  it("parses empty argv", () => {
    expect(parseArgs([])).toEqual({
      ...base,
      tailscale: false,
      help: false,
      login: false,
      logout: false,
      accountsList: false,
      accountName: "",
      proxies: [],
    });
  });

  it("parses --tailscale", () => {
    expect(parseArgs(["--tailscale"])).toEqual({
      ...base,
      tailscale: true,
      help: false,
      login: false,
      logout: false,
      accountsList: false,
      accountName: "",
      proxies: [],
    });
  });

  it("parses --help / -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses login command", () => {
    expect(parseArgs(["login", "my-account"])).toMatchObject({
      login: true,
      accountName: "my-account",
      proxies: [],
    });
  });

  it("parses login with multiple proxies", () => {
    expect(
      parseArgs([
        "login",
        "my-account",
        "--proxy=http://p1:8080,socks5://p2:1080,http://p3:3128",
      ]),
    ).toMatchObject({
      login: true,
      accountName: "my-account",
      proxies: ["http://p1:8080", "socks5://p2:1080", "http://p3:3128"],
    });
  });

  it("parses logout command", () => {
    expect(parseArgs(["logout", "my-account"])).toMatchObject({
      logout: true,
      accountName: "my-account",
    });
  });

  it("parses accounts command", () => {
    expect(parseArgs(["accounts"]).accountsList).toBe(true);
  });

  it("parses --port with space", () => {
    expect(parseArgs(["--port", "9000"]).port).toBe(9000);
  });

  it("parses --port= form", () => {
    expect(parseArgs(["--port=9000"]).port).toBe(9000);
  });

  it("throws on invalid --port", () => {
    expect(() => parseArgs(["--port", "abc"])).toThrow(/Invalid --port/);
    expect(() => parseArgs(["--port", "0"])).toThrow(/Invalid --port/);
    expect(() => parseArgs(["--port", "99999"])).toThrow(/Invalid --port/);
  });

  it("parses --host", () => {
    expect(parseArgs(["--host", "0.0.0.0"]).host).toBe("0.0.0.0");
    expect(parseArgs(["--host=localhost"]).host).toBe("localhost");
  });

  it("accumulates --config-dir across repeats", () => {
    const parsed = parseArgs([
      "--config-dir",
      "/tmp/a",
      "--config-dir=/tmp/b",
    ]);
    expect(parsed.configDirs).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("parses --multi-port", () => {
    expect(parseArgs(["--multi-port"]).multiPort).toBe(true);
  });

  it("throws on missing value for --port", () => {
    expect(() => parseArgs(["--port"])).toThrow(/Missing value/);
    expect(() => parseArgs(["--port", "--host"])).toThrow(/Missing value/);
  });

  it("throws on unknown argument", () => {
    expect(() => parseArgs(["--unknown"])).toThrow(
      "Unknown argument: --unknown",
    );
  });
});
