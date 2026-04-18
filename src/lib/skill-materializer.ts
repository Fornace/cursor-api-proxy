import * as fs from "node:fs";
import * as path from "node:path";

import { BUNDLED_SKILLS, renderSkillAsMdc, type BundledSkill } from "./bundled-skills.js";

/**
 * Extract the enum of skill names from an Anthropic Agent SDK tools array.
 *
 * The SDK registers a single tool named "Skill" with a schema like:
 *
 *   { name: "Skill",
 *     input_schema: {
 *       type: "object",
 *       properties: {
 *         skill: { type: "string", enum: ["simplify", "review", ...] },
 *         args:  { type: "string", description: "..." },
 *       }, required: ["skill"] } }
 *
 * Returns `undefined` if no Skill tool is present, the empty array if it's
 * present without an enum (meaning: no skills advertised), or the list of
 * advertised names otherwise.
 */
export function extractAdvertisedSkillNames(
  tools: unknown,
): string[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const tt = t as Record<string, unknown>;
    const name = tt.name ?? (tt.type === "function" && (tt.function as any)?.name);
    if (name !== "Skill") continue;
    const schema =
      (tt.input_schema as any) ??
      (tt.parameters as any) ??
      ((tt.function as any)?.parameters as any);
    const skillProp = schema?.properties?.skill;
    const enumVals = skillProp?.enum;
    if (Array.isArray(enumVals)) {
      return enumVals.filter((v): v is string => typeof v === "string");
    }
    return [];
  }
  return undefined;
}

/**
 * Materialize the subset of bundled Anthropic skills that the SDK is
 * advertising as `.cursor/rules/<name>.mdc` inside the resolved workspace, so
 * cursor-agent discovers them and follows them for `/<name>` invocations.
 *
 * - If `advertised` is `undefined`, no Skill tool was present — fall back to
 *   materialising every bundled skill so calls like `/simplify` still work
 *   when consumers don't wire up the Skill tool explicitly.
 * - If `advertised` is the empty array, the caller opted out of skills — write
 *   nothing.
 *
 * Existing `.mdc` files are not overwritten; callers managing their own rules
 * take precedence.
 */
export function materializeBundledSkills(
  workspaceDir: string,
  advertised: string[] | undefined,
): string[] {
  const names =
    advertised === undefined
      ? Object.keys(BUNDLED_SKILLS)
      : advertised.filter((n) => n in BUNDLED_SKILLS);
  if (names.length === 0) return [];

  const rulesDir = path.join(workspaceDir, ".cursor", "rules");
  try {
    fs.mkdirSync(rulesDir, { recursive: true });
  } catch {
    return [];
  }

  const written: string[] = [];
  for (const name of names) {
    const skill: BundledSkill = BUNDLED_SKILLS[name]!;
    const dest = path.join(rulesDir, `${skill.name}.mdc`);
    if (fs.existsSync(dest)) continue;
    try {
      fs.writeFileSync(dest, renderSkillAsMdc(skill), "utf8");
      written.push(skill.name);
    } catch {
      /* ignore — materialisation is best-effort */
    }
  }
  return written;
}
