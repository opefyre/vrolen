/**
 * VROL-676 — /help glossary of every KPI and term used in the results panel.
 * Linked from the results header so users can look up what "Line OEE" means
 * without leaving the app.
 *
 * VROL-805 — Adds a top-of-page search input that filters terms client-side,
 * and a per-term copy-link affordance that writes `${origin}/learn#anchor` to
 * the clipboard. Empty results render an `EmptyState`.
 *
 * VROL-834 — Renamed from /help to /learn. Adds a top-of-page tab strip for
 * "Glossary", "Concepts", and "Examples". Active tab is synced with the URL
 * via the `?section=` search param so deep-linking + back/forward work; the
 * Glossary content stays as-is, Concepts + Examples stub with an EmptyState
 * pending v1.1 content.
 */

import {
  Activity,
  Award,
  ExternalLink,
  Gauge,
  Layers,
  Link as LinkIcon,
  Lightbulb,
  SearchX,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { navigate, usePathname } from "@/lib/spa-nav";
import { toast } from "@/lib/toast";

interface Term {
  readonly icon: typeof Gauge;
  readonly title: string;
  readonly definition: string;
  readonly formula?: string;
  /** VROL-709 — optional external link for users who want to read more. */
  readonly learnMore?: string;
}

const KPI_TERMS: readonly Term[] = [
  {
    icon: Layers,
    title: "Completed parts",
    definition:
      "Number of finished parts that exited the line during the measurement window (after warmup).",
  },
  {
    icon: Gauge,
    title: "Throughput (λ)",
    definition: "Average parts produced per unit time. Reported per hour and per second.",
    formula: "completed / measurement window",
    learnMore: "https://en.wikipedia.org/wiki/Throughput",
  },
  {
    icon: Activity,
    title: "Average WIP (L)",
    definition:
      "Time-weighted average count of in-process parts: parts sitting in inter-station buffers plus parts being worked on.",
  },
  {
    icon: Timer,
    title: "Time-in-system (W)",
    definition:
      "Average time a finished part spent in the line, from arrival at the first station to exit. Little's Law: L = λW.",
    learnMore: "https://en.wikipedia.org/wiki/Little%27s_law",
  },
  {
    icon: Award,
    title: "Line efficiency",
    definition:
      "Actual line throughput as a fraction of the theoretical bottleneck rate. Different from per-station OEE — the station numbers don't roll up to this directly. Clamped to ≤ 100%.",
    formula: "actual throughput / theoretical max",
    learnMore: "https://en.wikipedia.org/wiki/Overall_equipment_effectiveness",
  },
  {
    icon: Award,
    title: "Per-station OEE",
    definition:
      "Availability × Performance × Quality at the station level. The slim factor is the lever you can pull.",
    formula: "A × P × Q",
  },
  {
    icon: Wrench,
    title: "Bottleneck",
    definition:
      "The station with the highest binding score (utilization × nominalSpeedRatio). Its effective rate caps the entire line — speeding up any other station won't help. On an unbalanced line the bottleneck is whichever station runs the most. On a perfectly balanced line where every station is at 100% running, the at-nominal-max station is the bottleneck (everyone else is throttled to match).",
    learnMore: "https://en.wikipedia.org/wiki/Theory_of_constraints",
  },
  {
    icon: Wrench,
    title: "Subordination",
    definition:
      "Deliberately running a non-bottleneck station BELOW its nominal max so it paces the bottleneck instead of jamming the line or burning MTBF for throughput it can't realise. Goldratt's second step of the Theory of Constraints. Surfaces in the canvas as a 'X% nom' chip on each subordinated station.",
    learnMore: "https://en.wikipedia.org/wiki/Theory_of_constraints",
  },
  {
    icon: Wrench,
    title: "Tight coupling",
    definition:
      "A line where buffers between stations are smaller than `bottleneck rate × mean MTTR`. The whole line stalls every time any station goes Down because there's no buffered WIP to absorb the outage. The Recommendations card warns when any buffer's coverage ratio is < 1.0 and suggests sizing at 1.5× absorption.",
    formula: "buffer ≥ bottleneck rate × MTTR",
  },
  {
    icon: Gauge,
    title: "Speed sweet spot (85–95% of nominal)",
    definition:
      "The operational sweet spot for running a non-bottleneck station. Below 85% is wasted capacity you could trade for MTBF later; above 95% raises breakdown rates non-linearly without lifting throughput (the line is bottleneck-bound). The simulator emits a low-severity recommendation when a non-bottleneck is at > 95% AND has non-zero breakdowns or defects.",
  },
];

const STATE_TERMS: readonly { readonly name: string; readonly definition: string }[] = [
  {
    name: "Running",
    definition:
      "Station is actively processing a part. Higher Running % usually means a tighter bottleneck.",
  },
  {
    name: "Starved",
    definition:
      "Station has capacity but no upstream part to work on. Upstream is too slow or the buffer ran dry.",
  },
  {
    name: "Blocked",
    definition: "Station finished a part but can't push it downstream — the next buffer is full.",
  },
  {
    name: "Down",
    definition: "Station is broken (MTBF/MTTR breakdown). Counts as unplanned downtime in OEE.",
  },
  {
    name: "Setup",
    definition: "Changeover between products. Counts against Performance, not Availability.",
  },
  {
    name: "Maintenance",
    definition: "Planned preventive maintenance. Excluded from OEE Availability.",
  },
  { name: "Idle", definition: "Station is outside its scheduled shift or is off-shift." },
];

type LearnSection = "glossary" | "concepts" | "examples";

function isLearnSection(value: string | null): value is LearnSection {
  return value === "glossary" || value === "concepts" || value === "examples";
}

function readSection(): LearnSection {
  if (typeof window === "undefined") return "glossary";
  const raw = new URLSearchParams(window.location.search).get("section");
  return isLearnSection(raw) ? raw : "glossary";
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * AND-match the query tokens against the haystack. An empty query matches
 * everything; otherwise every whitespace-separated token must be a substring
 * of the lower-cased haystack.
 */
function matchesQuery(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = haystack.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

function copyAnchorLink(anchor: string): void {
  if (typeof window === "undefined") return;
  const href = `${window.location.origin}/learn#${anchor}`;
  try {
    void navigator.clipboard?.writeText(href);
    toast.success("Link copied", { description: anchor });
  } catch {
    toast.message("Link", { description: href });
  }
}

export default function LearnPage() {
  // VROL-834 — re-render when the URL changes (back/forward) so the active
  // tab follows. `usePathname` already subscribes to `popstate`, which is
  // what `navigate(...)` dispatches when we update the search param. The
  // section is derived from the URL on every render so the URL stays the
  // source of truth — no useState mirror to drift out of sync.
  usePathname();
  const section: LearnSection = readSection();

  const handleSectionChange = (next: string): void => {
    if (!isLearnSection(next)) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    navigate(`${url.pathname}${url.search}${url.hash}`, { replace: true });
  };

  const [query, setQuery] = useState<string>("");
  const trimmed = query.trim();
  const tokens = useMemo<readonly string[]>(
    () =>
      trimmed.length === 0
        ? []
        : trimmed
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length > 0),
    [trimmed],
  );

  const kpiMatches = useMemo(
    () => KPI_TERMS.filter((t) => matchesQuery(`${t.title} ${t.definition}`, tokens)),
    [tokens],
  );
  const stateMatches = useMemo(
    () => STATE_TERMS.filter((s) => matchesQuery(`${s.name} ${s.definition}`, tokens)),
    [tokens],
  );

  const hasResults = kpiMatches.length > 0 || stateMatches.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Learn</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          KPI definitions, concepts, and worked examples for the simulator.
        </p>
      </div>

      {/* VROL-834 — tab strip drives `?section=` for deep linking + back/forward. */}
      <Tabs value={section} onValueChange={handleSectionChange}>
        <TabsList>
          <TabsTrigger value="glossary">Glossary</TabsTrigger>
          <TabsTrigger value="concepts">Concepts</TabsTrigger>
          <TabsTrigger value="examples">Examples</TabsTrigger>
        </TabsList>

        <TabsContent value="glossary" className="space-y-6">
          {/* VROL-805 — client-side search across KPI + state terms. */}
          <div>
            <label htmlFor="glossary-search" className="sr-only">
              Search glossary
            </label>
            <Input
              id="glossary-search"
              type="search"
              placeholder="Search glossary (e.g. throughput, bottleneck)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              autoComplete="off"
            />
          </div>

          {!hasResults ? (
            <EmptyState
              icon={SearchX}
              title="No matches"
              body={
                <>
                  No glossary entries match &ldquo;{trimmed}&rdquo;. Try a shorter or different
                  query.
                </>
              }
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                  }}
                >
                  Clear search
                </Button>
              }
            />
          ) : null}

          {kpiMatches.length > 0 ? (
            <Card id="kpis">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2 text-lg">
                  <span className="bg-sim-running inline-block h-2 w-2 rounded-full" aria-hidden />
                  KPIs
                </CardTitle>
                <CardDescription>What every number in the results panel means.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  {kpiMatches.map((t) => {
                    const Icon = t.icon;
                    const anchor = slugify(t.title);
                    return (
                      <div key={t.title} id={anchor} className="group flex scroll-mt-4 gap-3">
                        <Icon
                          className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0"
                          aria-hidden
                        />
                        <div className="flex-1 space-y-1">
                          <dt className="flex items-center gap-1.5 text-sm font-semibold">
                            <span>{t.title}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Copy link to ${t.title}`}
                              onClick={() => {
                                copyAnchorLink(anchor);
                              }}
                              className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <LinkIcon aria-hidden />
                            </Button>
                          </dt>
                          <dd className="text-foreground/80 text-sm leading-relaxed">
                            {t.definition}
                          </dd>
                          {t.formula ? (
                            <code className="bg-muted inline-block rounded px-1.5 py-0.5 text-xs">
                              {t.formula}
                            </code>
                          ) : null}
                          {t.learnMore ? (
                            <a
                              href={t.learnMore}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground ml-2 inline-flex items-center gap-0.5 text-[11px] underline-offset-2 hover:underline"
                            >
                              Learn more
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {stateMatches.length > 0 ? (
            <Card id="states">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2 text-lg">
                  <span className="bg-sim-setup inline-block h-2 w-2 rounded-full" aria-hidden />
                  Station states
                </CardTitle>
                <CardDescription>What each colored band in the state Pareto means.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  {stateMatches.map((s) => {
                    const anchor = slugify(s.name);
                    return (
                      <div key={s.name} id={anchor} className="group scroll-mt-4">
                        <dt className="flex items-center gap-1.5 text-sm font-semibold">
                          <span>{s.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Copy link to ${s.name}`}
                            onClick={() => {
                              copyAnchorLink(anchor);
                            }}
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <LinkIcon aria-hidden />
                          </Button>
                        </dt>
                        <dd className="text-foreground/80 text-sm">{s.definition}</dd>
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="concepts">
          <EmptyState
            icon={Lightbulb}
            title="Concepts coming soon"
            body="Worked walkthroughs of bottlenecks, Little's Law, and buffer sizing will land in v1.1."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  handleSectionChange("glossary");
                }}
              >
                Back to glossary
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="examples">
          <EmptyState
            icon={Sparkles}
            title="Examples coming soon"
            body="Step-by-step worked examples — load a preset, run, interpret — will land in v1.1."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate("/templates");
                }}
              >
                Browse templates
              </Button>
            }
          />
        </TabsContent>
      </Tabs>

      {/* VROL-754 — footer link back to the editor. */}
      <div className="text-muted-foreground flex items-center justify-end text-xs">
        <a
          href="/editor"
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate("/editor");
          }}
          className="hover:text-foreground underline-offset-2 hover:underline"
        >
          Back to /editor →
        </a>
      </div>
    </div>
  );
}
