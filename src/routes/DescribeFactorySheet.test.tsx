import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DescribeFactorySheet } from "./DescribeFactorySheet";
import { createInMemoryProviderKeyStore } from "@/ai/provider-keys";
import type { ScenarioGenerationResult } from "@/ai/scenario-tool";
import type { GeneratedScenario } from "@/ai/scenario-schema";

const okScenario: GeneratedScenario = {
  stations: [
    { id: "s1", label: "Mixer", cycleMs: 60 },
    { id: "s2", label: "Packer", cycleMs: 90 },
  ],
  edges: [{ source: "s1", target: "s2" }],
  settings: { horizonMs: 60_000, warmupMs: 5_000, replications: 3, interStationBufferCapacity: 8 },
};

const okResult: ScenarioGenerationResult = { ok: true, scenario: okScenario, attempts: 1 };

describe("DescribeFactorySheet (VROL-402)", () => {
  it("disables Generate until both API key + prompt are filled", () => {
    const store = createInMemoryProviderKeyStore();
    render(
      <DescribeFactorySheet
        open
        onOpenChange={() => undefined}
        onApply={() => undefined}
        keyStore={store}
        generate={async () => okResult}
      />,
    );
    const btn = screen.getByTestId("describe-factory-generate");
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId("describe-factory-key"), { target: { value: "sk-x" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByTestId("describe-factory-prompt"), {
      target: { value: "A line." },
    });
    expect(btn).toBeEnabled();
  });

  it("renders the preview + Apply button on success and calls onApply", async () => {
    const store = createInMemoryProviderKeyStore();
    const onApply = vi.fn();
    render(
      <DescribeFactorySheet
        open
        onOpenChange={() => undefined}
        onApply={onApply}
        keyStore={store}
        generate={async () => okResult}
      />,
    );
    fireEvent.change(screen.getByTestId("describe-factory-key"), { target: { value: "sk-x" } });
    fireEvent.change(screen.getByTestId("describe-factory-prompt"), {
      target: { value: "A line." },
    });
    fireEvent.click(screen.getByTestId("describe-factory-generate"));
    await waitFor(() => {
      expect(screen.getByTestId("describe-factory-preview")).toBeInTheDocument();
    });
    expect(screen.getByText(/Mixer/)).toBeInTheDocument();
    expect(screen.getByText(/Packer/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("describe-factory-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [graph, originalPrompt] = onApply.mock.calls[0] ?? [];
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(originalPrompt).toBe("A line.");
  });

  it("renders an error band when generation fails", async () => {
    const store = createInMemoryProviderKeyStore();
    render(
      <DescribeFactorySheet
        open
        onOpenChange={() => undefined}
        onApply={() => undefined}
        keyStore={store}
        generate={async () => ({
          ok: false,
          kind: "max-retries",
          attempts: 3,
          lastError: "schema failed",
        })}
      />,
    );
    fireEvent.change(screen.getByTestId("describe-factory-key"), { target: { value: "k" } });
    fireEvent.change(screen.getByTestId("describe-factory-prompt"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("describe-factory-generate"));
    await waitFor(() => {
      expect(screen.getByTestId("describe-factory-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("describe-factory-error").textContent).toMatch(/schema failed/);
  });

  it("persists the API key to the store when remember-key is checked", async () => {
    const store = createInMemoryProviderKeyStore();
    render(
      <DescribeFactorySheet
        open
        onOpenChange={() => undefined}
        onApply={() => undefined}
        keyStore={store}
        generate={async () => okResult}
      />,
    );
    fireEvent.change(screen.getByTestId("describe-factory-key"), { target: { value: "sk-abc" } });
    fireEvent.change(screen.getByTestId("describe-factory-prompt"), { target: { value: "p" } });
    fireEvent.click(screen.getByTestId("describe-factory-generate"));
    await waitFor(() => {
      expect(store.get("openai")?.apiKey).toBe("sk-abc");
    });
  });
});
