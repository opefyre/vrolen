/**
 * VROL-442 — /templates route. Dedicated gallery showing every preset
 * with topology preview, category, and "Load" CTA. Landing already
 * surfaces the same set, but this route is a deeper view that's
 * linkable + bookmarkable.
 *
 * VROL-446 — explicit "Bottling line" hero block at the top so the
 * canonical example is the first thing a visitor sees.
 *
 * VROL-804 — adds a free-text filter so a long preset list stays
 * scannable. When the filter matches nothing, renders the shared
 * `EmptyState` primitive with a single "Clear filter" CTA per the
 * canonical CTA tree (primary → optional secondary → tertiary link).
 */

import { ArrowRight, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { TopologyPreview } from "@/components/landing/topology-preview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESETS, setPendingPreset, type Preset } from "@/lib/presets";
import { navigate } from "@/lib/spa-nav";

const HERO_ID = "bottling-line";

function loadInto(presetId: string): void {
  // VROL-829 — SPA nav so the editor's lazy chunk is reused (no full reload).
  setPendingPreset(presetId);
  navigate("/editor");
}

function matchesFilter(preset: Preset, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = `${preset.title} ${preset.blurb} ${preset.highlight}`.toLowerCase();
  return haystack.includes(query);
}

// VROL-1023 — collected tag vocabulary across all presets, sorted by
// frequency so the busiest categories appear first.
function collectTags(presets: readonly Preset[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const p of presets) {
    for (const t of p.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

function PresetRow({ preset }: { readonly preset: Preset }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading text-base">{preset.title}</CardTitle>
          <CardDescription>{preset.blurb}</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            loadInto(preset.id);
          }}
          className="shrink-0 gap-1"
        >
          Load
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="bg-background/40 border-border rounded-md border">
          <TopologyPreview nodes={preset.graph.nodes} edges={preset.graph.edges} />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">{preset.highlight}</p>
      </CardContent>
    </Card>
  );
}

export default function TemplatesPage() {
  const [filter, setFilter] = useState<string>("");
  // VROL-1023 — active tag chip. null = "all".
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const trimmed = filter.trim().toLowerCase();

  const tags = useMemo(() => collectTags(PRESETS), []);
  const filtered = useMemo(
    () =>
      PRESETS.filter((p) => matchesFilter(p, trimmed)).filter(
        (p) => activeTag === null || (p.tags ?? []).includes(activeTag as never),
      ),
    [trimmed, activeTag],
  );
  const hero = filtered.find((p) => p.id === HERO_ID);
  const rest = filtered.filter((p) => p.id !== HERO_ID);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Templates</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Pre-built scenarios that exercise distinct engine features. Loading replaces the canvas +
          run settings with the preset's editable copy.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="templates-filter" className="sr-only">
          Filter templates
        </label>
        <Input
          id="templates-filter"
          type="search"
          placeholder="Filter templates (e.g. bottling, parallel, breakdown)"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
          autoComplete="off"
          data-testid="templates-filter"
        />
        {/* VROL-1023 — tag chips. "All" plus each declared tag. */}
        <div className="flex flex-wrap gap-1.5" data-testid="templates-tag-chips">
          <button
            type="button"
            onClick={() => {
              setActiveTag(null);
            }}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] tracking-wide uppercase ${
              activeTag === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
            data-testid="templates-tag-all"
          >
            All
          </button>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setActiveTag(activeTag === t ? null : t);
              }}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] tracking-wide uppercase ${
                activeTag === t
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
              data-testid={`templates-tag-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No templates match"
          body={
            <>
              Nothing matches &ldquo;{filter.trim()}&rdquo;. Try a shorter query or clear the filter
              to see every template.
            </>
          }
          action={
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setFilter("");
              }}
              data-testid="templates-clear-filter"
            >
              Clear filter
            </Button>
          }
        />
      ) : null}

      {hero ? (
        <section className="space-y-2">
          <h2 className="font-heading flex items-center gap-2 text-lg font-semibold">
            <span className="bg-sim-running inline-block h-2 w-2 rounded-full" aria-hidden />
            Bottling line
            <span className="bg-sim-running/15 text-sim-running rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
              Featured
            </span>
          </h2>
          <PresetRow preset={hero} />
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-heading text-lg font-semibold">
            {hero ? "More templates" : "Templates"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {rest.map((p) => (
              <PresetRow key={p.id} preset={p} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
