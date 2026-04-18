import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  extractAdvertisedSkillNames,
  materializeBundledSkills,
} from "./skill-materializer.js";

describe("extractAdvertisedSkillNames", () => {
  it("returns undefined when no Skill tool is present", () => {
    expect(extractAdvertisedSkillNames(undefined)).toBeUndefined();
    expect(extractAdvertisedSkillNames([])).toBeUndefined();
    expect(
      extractAdvertisedSkillNames([{ name: "Bash", input_schema: {} }]),
    ).toBeUndefined();
  });

  it("extracts the skill enum from an Anthropic Skill tool entry", () => {
    const tools = [
      { name: "Bash", input_schema: {} },
      {
        name: "Skill",
        input_schema: {
          type: "object",
          properties: {
            skill: {
              type: "string",
              enum: ["simplify", "review", "custom-thing"],
            },
          },
        },
      },
    ];
    expect(extractAdvertisedSkillNames(tools)).toEqual([
      "simplify",
      "review",
      "custom-thing",
    ]);
  });

  it("returns empty array when Skill tool has no enum", () => {
    const tools = [{ name: "Skill", input_schema: { type: "object" } }];
    expect(extractAdvertisedSkillNames(tools)).toEqual([]);
  });

  it("handles OpenAI-style function wrapping", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "Skill",
          parameters: {
            properties: { skill: { enum: ["simplify"] } },
          },
        },
      },
    ];
    expect(extractAdvertisedSkillNames(tools)).toEqual(["simplify"]);
  });
});

describe("materializeBundledSkills", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-materializer-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes .cursor/rules/<name>.mdc for each advertised bundled skill", () => {
    const written = materializeBundledSkills(dir, ["simplify", "review"]);
    expect(written.sort()).toEqual(["review", "simplify"]);
    const simplify = fs.readFileSync(
      path.join(dir, ".cursor", "rules", "simplify.mdc"),
      "utf8",
    );
    expect(simplify).toMatch(/^---\ndescription: /);
    expect(simplify).toMatch(/alwaysApply: false/);
    expect(simplify).toContain("# Simplify: Code Review and Cleanup");
  });

  it("ignores advertised skills we don't have bundled", () => {
    const written = materializeBundledSkills(dir, ["simplify", "unknown-xyz"]);
    expect(written).toEqual(["simplify"]);
    expect(
      fs.existsSync(path.join(dir, ".cursor", "rules", "unknown-xyz.mdc")),
    ).toBe(false);
  });

  it("materialises every bundled skill when advertised is undefined", () => {
    const written = materializeBundledSkills(dir, undefined);
    expect(written.sort()).toEqual([
      "init",
      "review",
      "security-review",
      "simplify",
    ]);
  });

  it("writes nothing when the advertised list is empty", () => {
    const written = materializeBundledSkills(dir, []);
    expect(written).toEqual([]);
    expect(fs.existsSync(path.join(dir, ".cursor", "rules"))).toBe(false);
  });

  it("does not overwrite existing rule files", () => {
    const rulesDir = path.join(dir, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    const existing = path.join(rulesDir, "simplify.mdc");
    fs.writeFileSync(existing, "caller-authored rule", "utf8");
    const written = materializeBundledSkills(dir, ["simplify"]);
    expect(written).toEqual([]);
    expect(fs.readFileSync(existing, "utf8")).toBe("caller-authored rule");
  });
});
