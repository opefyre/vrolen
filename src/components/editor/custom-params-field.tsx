/**
 * VROL-286 — customParams editor. Table-style key-value editor for
 * arbitrary metadata on a station (or any entity). Values are coerced
 * when the type changes. Reserved names (built-in node.data keys) are
 * rejected to prevent shadowing.
 */

import { Trash2 } from "lucide-react";
import { useState } from "react";

import {
  coerceCustomParamValue,
  RESERVED_PARAM_NAMES,
  type CustomParam,
  type CustomParamType,
} from "@/lib/custom-params";

interface CustomParamsFieldProps {
  readonly value: readonly CustomParam[];
  readonly onChange: (next: readonly CustomParam[]) => void;
}

export function CustomParamsField({ value, onChange }: CustomParamsFieldProps) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addRow = (): void => {
    const n = newName.trim();
    if (!n) {
      setError("Name is required");
      return;
    }
    if (RESERVED_PARAM_NAMES.has(n)) {
      setError(`"${n}" is a reserved field name`);
      return;
    }
    if (value.some((p) => p.name === n)) {
      setError(`"${n}" already exists`);
      return;
    }
    onChange([...value, { name: n, type: "string", value: "" }]);
    setNewName("");
    setError(null);
  };

  const updateRow = (idx: number, patch: Partial<CustomParam>): void => {
    onChange(
      value.map((p, i) => {
        if (i !== idx) return p;
        const next: CustomParam = { ...p, ...patch };
        // Coerce value when the type changes so the value stays valid.
        if (patch.type && patch.type !== p.type) {
          return { ...next, value: coerceCustomParamValue(patch.type, p.value) };
        }
        return next;
      }),
    );
  };

  const removeRow = (idx: number): void => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground text-xs font-medium">Custom params</div>
      {value.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">
          Arbitrary named metadata. Useful for AI prompts + future custom KPIs.
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="space-y-1" data-testid="custom-params-rows">
          {value.map((p, idx) => (
            <li
              key={`${p.name}-${String(idx)}`}
              className="border-border bg-card flex items-center gap-1.5 rounded-md border p-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{p.name}</span>
              <select
                value={p.type}
                onChange={(e) => {
                  updateRow(idx, { type: e.target.value as CustomParamType });
                }}
                className="border-input bg-background h-6 rounded-md border px-1 text-[11px]"
                aria-label={`Type for ${p.name}`}
              >
                <option value="string">str</option>
                <option value="number">num</option>
                <option value="boolean">bool</option>
              </select>
              {p.type === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(p.value)}
                  onChange={(e) => {
                    updateRow(idx, { value: e.target.checked });
                  }}
                  aria-label={`Value for ${p.name}`}
                />
              ) : (
                <input
                  type={p.type === "number" ? "number" : "text"}
                  value={String(p.value)}
                  onChange={(e) => {
                    updateRow(idx, {
                      value: p.type === "number" ? Number(e.target.value) : e.target.value,
                    });
                  }}
                  aria-label={`Value for ${p.name}`}
                  className="border-input bg-background h-6 w-20 rounded-md border px-1.5 font-mono text-[11px]"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  removeRow(idx);
                }}
                className="text-muted-foreground hover:text-destructive shrink-0 p-0.5"
                aria-label={`Remove ${p.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRow();
            }
          }}
          placeholder="param_name"
          aria-label="New param name"
          className="border-input bg-background h-7 flex-1 rounded-md border px-2 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={addRow}
          className="border-input bg-background hover:bg-muted h-7 rounded-md border px-2 text-[11px]"
        >
          + Add
        </button>
      </div>
      {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
    </div>
  );
}
