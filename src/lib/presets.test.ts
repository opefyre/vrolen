import { describe, expect, it } from "vitest";

import { runChain, SeededPrng } from "@/engine";

import { graphToChainOptions } from "./graph-to-chain";
import { PRESETS, getPreset } from "./presets";

describe("presets (VROL-630)", () => {
  it("each preset has a non-empty title + blurb + highlight", () => {
    for (const p of PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.highlight.length).toBeGreaterThan(0);
    }
  });

  it("each preset's graph has at least 3 stations + at least 2 edges", () => {
    for (const p of PRESETS) {
      expect(p.graph.nodes.length).toBeGreaterThanOrEqual(3);
      expect(p.graph.edges.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("getPreset(id) resolves a known preset and returns undefined for unknown", () => {
    expect(getPreset("bottling-line")?.id).toBe("bottling-line");
    expect(getPreset("nope")).toBeUndefined();
  });

  it("each preset's graph round-trips through the translator without errors", () => {
    for (const p of PRESETS) {
      const r = graphToChainOptions(p.graph.nodes, p.graph.edges);
      expect(r.error).toBeNull();
    }
  });

  it("Parallel fillers preset has a Filler with capacity > 1 (VROL-649)", () => {
    const p = getPreset("parallel-fillers");
    expect(p).toBeDefined();
    const filler = p!.graph.nodes.find((n) => (n.data as { label?: string }).label === "Filler");
    expect(filler).toBeDefined();
    expect((filler!.data as { capacity?: number }).capacity).toBe(3);
  });

  it("Source rate preset has finite-rate source enabled (VROL-656)", () => {
    const p = getPreset("source-rate");
    expect(p).toBeDefined();
    expect(p!.settings.source.enabled).toBe(true);
    expect(p!.settings.source.intervalMs).toBeGreaterThan(0);
  });

  it("Mixed-Model Job Shop preset has 3 products + changeover matrix (VROL-452)", () => {
    const p = getPreset("mixed-model-job-shop");
    expect(p).toBeDefined();
    expect(p!.settings.products.list).toHaveLength(3);
    const lathe = p!.graph.nodes.find((n) => (n.data as { label?: string }).label === "Lathe");
    expect((lathe!.data as { changeoverMatrix?: unknown }).changeoverMatrix).toBeDefined();
  });

  it("Pharma Packaging preset gates QC behind a certified skill (VROL-455)", () => {
    const p = getPreset("pharma-packaging");
    expect(p).toBeDefined();
    const qc1 = p!.graph.nodes.find((n) => n.id === "qc1");
    expect((qc1!.data as { skills?: string[] }).skills).toContain("qc-cert");
    // Only one of the two workers has the cert.
    const certCount = p!.settings.workers.list.filter((w) => w.skills.includes("qc-cert")).length;
    expect(certCount).toBe(1);
  });

  it("Two-line packing preset runs + Packer is the bottleneck (VROL-449)", () => {
    const p = getPreset("two-line-packing");
    expect(p).toBeDefined();
    const translation = graphToChainOptions(p!.graph.nodes, p!.graph.edges);
    expect(translation.error).toBeNull();
    const result = runChain({
      ...(translation.topology
        ? { topology: translation.topology }
        : { stationCycleTimes: [...translation.cycleDistributions] }),
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(7),
    });
    expect(result.completed).toBeGreaterThan(0);
    // Packer runs at the highest occupancy = bottleneck.
    expect(result.bottlenecks[0]?.label).toBe("Packer");
  });

  it("Bottling line preset runs end-to-end and produces completed parts", () => {
    const p = getPreset("bottling-line");
    expect(p).toBeDefined();
    const translation = graphToChainOptions(p!.graph.nodes, p!.graph.edges);
    expect(translation.error).toBeNull();
    const result = runChain({
      ...(translation.topology
        ? { topology: translation.topology }
        : { stationCycleTimes: [...translation.cycleDistributions] }),
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    expect(result.completed).toBeGreaterThan(0);
  });
});
