import { useState } from "react";

import { Input } from "@/components/ui/input";

interface SkillsFieldProps {
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly id: string;
  readonly helpText?: string;
}

export function SkillsField({
  value,
  onChange,
  label,
  placeholder,
  id,
  helpText,
}: SkillsFieldProps) {
  const joined = value.join(", ");
  const [draft, setDraft] = useState<string>(joined);
  const [lastJoined, setLastJoined] = useState<string>(joined);
  if (joined !== lastJoined) {
    setLastJoined(joined);
    setDraft(joined);
  }

  const commit = (raw: string): void => {
    const tags = raw
      .split(/[\s,]+/g)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    onChange(Array.from(new Set(tags)));
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={(e) => {
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className="font-mono text-sm tabular-nums"
      />
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {helpText ? <p className="text-muted-foreground text-xs">{helpText}</p> : null}
    </div>
  );
}
