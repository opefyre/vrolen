/**
 * VROL-789 — Scenarios drawer body: 2 last-used primary buttons,
 * everything else collapsed under "More scenarios… ({count})", a search
 * input that filters the FULL list, and an empty state when the search
 * yields nothing.
 *
 * This is a presentational wrapper. The Scenarios drawer in EditorPage
 * carries a lot of per-row state (confirm actions, notes, replay, etc.)
 * — the component takes a `renderItem` render-prop so the parent owns
 * that complexity. Recency tracking lives in scenario-store via
 * `lastUsedAtMs`; we fall back to `savedAtMs` for legacy entries.
 */

import { Save } from "lucide-react";
import { useMemo, useState } from "react";

import type { ScenarioSummary } from "@/lib/scenario-store";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ScenariosListProps {
  readonly scenarios: readonly ScenarioSummary[];
  readonly activeScenarioName: string | null;
  readonly onPrimaryLoad: (name: string) => void;
  readonly renderItem: (scenario: ScenarioSummary) => React.ReactNode;
}

function recencyOf(s: ScenarioSummary): number {
  return s.lastUsedAtMs ?? s.savedAtMs;
}

export function ScenariosList({
  scenarios,
  activeScenarioName,
  onPrimaryLoad,
  renderItem,
}: ScenariosListProps) {
  const [search, setSearch] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState<boolean>(false);

  const trimmed = search.trim().toLowerCase();
  const matchesQuery = (s: ScenarioSummary): boolean =>
    trimmed === "" ? true : s.name.toLowerCase().includes(trimmed);

  // The 2 most-recently-used scenarios become primary buttons at the top.
  // They're computed from the full list (ignoring search) so the user can
  // always see what their last 2 were. The search filter still hides them
  // if they don't match — same rule as the rest of the list.
  const primary = useMemo<readonly ScenarioSummary[]>(() => {
    return [...scenarios].sort((a, b) => recencyOf(b) - recencyOf(a)).slice(0, 2);
  }, [scenarios]);

  const primaryNames = new Set(primary.map((s) => s.name));
  const rest = scenarios.filter((s) => !primaryNames.has(s.name));

  const primaryFiltered = primary.filter(matchesQuery);
  const restFiltered = rest.filter(matchesQuery);

  const totalFiltered = primaryFiltered.length + restFiltered.length;
  const noResults = trimmed !== "" && totalFiltered === 0;

  if (scenarios.length === 0) {
    return (
      <EmptyState
        icon={Save}
        title="No saved scenarios yet"
        body={
          <>
            Click <strong>Save current</strong> to capture the graph + run settings under a name.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="scenarios-list">
      <Input
        type="search"
        value={search}
        placeholder="Search scenarios…"
        onChange={(e) => {
          setSearch(e.target.value);
        }}
        data-testid="scenario-search"
        className="text-sm"
        aria-label="Search saved scenarios"
      />

      {noResults ? (
        <EmptyState
          icon={Save}
          title="No matches"
          body={<>No scenarios match the current search. Clear the box to see all of them.</>}
        />
      ) : (
        <>
          {primaryFiltered.length > 0 ? (
            <div className="space-y-2" data-testid="scenarios-primary">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                Recently used
              </div>
              <div className="flex flex-col gap-1.5">
                {primaryFiltered.map((s) => (
                  <Button
                    key={`primary-${s.name}`}
                    type="button"
                    variant="default"
                    size="sm"
                    className="justify-between gap-2"
                    onClick={() => {
                      onPrimaryLoad(s.name);
                    }}
                    aria-label={`Load scenario ${s.name}`}
                  >
                    <span className="truncate">
                      {s.name}
                      {activeScenarioName === s.name ? (
                        <span className="ml-2 text-[10px] opacity-75">active</span>
                      ) : null}
                    </span>
                    <span className="text-[10px] tabular-nums opacity-75">
                      {s.nodeCount} node{s.nodeCount === 1 ? "" : "s"}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {restFiltered.length > 0 ? (
            <details
              className="border-border rounded-md border"
              open={moreOpen || trimmed !== ""}
              onToggle={(e) => {
                setMoreOpen((e.currentTarget as HTMLDetailsElement).open);
              }}
              data-testid="scenarios-more"
            >
              <summary className="text-muted-foreground hover:bg-muted/40 cursor-pointer px-3 py-2 text-xs font-medium select-none">
                More scenarios… ({restFiltered.length})
              </summary>
              <ul className="space-y-2 px-2 pt-1 pb-2">
                {restFiltered.map((s) => (
                  <li key={s.name}>{renderItem(s)}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* If a primary is filtered into the visible set but the rest are
              hidden, still show the rich item card for that primary so users
              don't lose access to delete / notes / etc. */}
          {primaryFiltered.length > 0 ? (
            <ul className="space-y-2">
              {primaryFiltered.map((s) => (
                <li key={`detail-${s.name}`}>{renderItem(s)}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
