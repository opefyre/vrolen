import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChainResult } from "@/engine";

import {
  PlaybackCheatSheet,
  PlaybackReplayBanner,
  PlaybackStationKpiPanel,
} from "./PlaybackOverlays";

describe("PlaybackReplayBanner (VROL-1193)", () => {
  it("renders when a result is present and playback isn't live", () => {
    render(<PlaybackReplayBanner hasResult isLive={false} />);
    expect(screen.getByTestId("playback-replay-banner")).toBeInTheDocument();
  });

  it("hides when playback is live", () => {
    render(<PlaybackReplayBanner hasResult isLive />);
    expect(screen.queryByTestId("playback-replay-banner")).toBeNull();
  });

  it("hides when there is no result", () => {
    render(<PlaybackReplayBanner hasResult={false} isLive={false} />);
    expect(screen.queryByTestId("playback-replay-banner")).toBeNull();
  });
});

describe("PlaybackCheatSheet (VROL-1192)", () => {
  it("renders when open + lists shortcuts", () => {
    render(<PlaybackCheatSheet open onClose={() => undefined} />);
    expect(screen.getByTestId("playback-cheat-sheet")).toBeInTheDocument();
    expect(screen.getByText(/Focus bottleneck/)).toBeInTheDocument();
    expect(screen.getByText(/Toggle this cheat sheet/)).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<PlaybackCheatSheet open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("playback-cheat-sheet-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<PlaybackCheatSheet open={false} onClose={() => undefined} />);
    expect(screen.queryByTestId("playback-cheat-sheet")).toBeNull();
  });
});

describe("PlaybackStationKpiPanel (VROL-1190)", () => {
  const result = {
    perStationRunningPct: [0.8],
    perStationOee: [
      {
        availability: 0.9,
        performance: 0.85,
        quality: 0.95,
        oee: 0.72675,
      },
    ],
    perStationCompleted: [1234],
    perStationScrapped: [42],
    perStationLabels: ["Filler"],
  } as unknown as ChainResult;

  it("renders KPIs for the given topology index", () => {
    render(
      <PlaybackStationKpiPanel
        stationId="n1"
        stationLabel="Filler"
        result={result}
        topologyIndex={0}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("playback-station-kpi")).toBeInTheDocument();
    expect(screen.getByText("Filler")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument(); // utilization
    expect(screen.getByText("1,234")).toBeInTheDocument(); // completed
    expect(screen.getByText("42")).toBeInTheDocument(); // scrapped
  });

  it("shows em-dashes when result is null", () => {
    render(
      <PlaybackStationKpiPanel
        stationId="n1"
        stationLabel="Filler"
        result={null}
        topologyIndex={null}
        onClose={() => undefined}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders nothing when stationId is null", () => {
    render(
      <PlaybackStationKpiPanel
        stationId={null}
        stationLabel={null}
        result={result}
        topologyIndex={null}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByTestId("playback-station-kpi")).toBeNull();
  });

  it("calls onClose when Esc button clicked", () => {
    const onClose = vi.fn();
    render(
      <PlaybackStationKpiPanel
        stationId="n1"
        stationLabel="Filler"
        result={result}
        topologyIndex={0}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("playback-station-kpi-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
