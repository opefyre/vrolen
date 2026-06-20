/**
 * VROL-286 — shared types + constants for the customParams editor.
 * Split from custom-params-field.tsx so the component file can satisfy
 * react-refresh's "only export components" rule.
 */

export type CustomParamType = "number" | "string" | "boolean";

export interface CustomParam {
  readonly name: string;
  readonly type: CustomParamType;
  readonly value: number | string | boolean;
}

/** Built-in node.data keys that customParams must not shadow. */
export const RESERVED_PARAM_NAMES = new Set([
  "label",
  "stationType",
  "stationKey",
  "cycleDistribution",
  "cycleMs",
  "cycleByProduct",
  "setupDistribution",
  "changeoverMatrix",
  "defectRate",
  "reworkTargetNodeId",
  "reworkPassLimit",
  "capacity",
  "skills",
  "maintenanceWindows",
  "customDescription",
  "customParams",
  "sparklineSeries",
  "_validationSeverity",
]);

export function coerceCustomParamValue(
  type: CustomParamType,
  raw: unknown,
): number | string | boolean {
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return raw === true || raw === "true" || raw === 1 || raw === "1";
    case "string":
      return typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw);
  }
}
