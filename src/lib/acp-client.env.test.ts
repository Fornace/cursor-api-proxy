import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAcpSpawnEnv } from "./acp-client.js";

describe("buildAcpSpawnEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forces CURSOR_SKIP_KEYCHAIN=1 when parent env disables it", () => {
    vi.stubEnv("CURSOR_SKIP_KEYCHAIN", "0");
    const env = buildAcpSpawnEnv();
    expect(env.CURSOR_SKIP_KEYCHAIN).toBe("1");
  });

  it("cannot be overridden by extra config", () => {
    const env = buildAcpSpawnEnv({ CURSOR_SKIP_KEYCHAIN: "0" });
    expect(env.CURSOR_SKIP_KEYCHAIN).toBe("1");
  });
});
