/**
 * Custom canvas zoom/fit controls (replaces react-flow's default <Controls/>).
 *
 * Why: react-flow's default Controls render via its own CSS; depending on
 * load order / theme, the lower buttons (fit-view, interactivity) sometimes
 * fail to surface visibly. This shadcn + lucide replacement is theme-aware,
 * always renders crisp icons, and stays in step with the rest of the app's
 * UI surface.
 */

import { Lock, Maximize2, Minus, Plus, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReactFlow, useStore } from "@xyflow/react";

interface ControlButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly pressed?: boolean;
}

function ControlButton({ label, onClick, children, pressed }: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className="hover:bg-accent h-7 w-7 rounded-none border-0"
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const elementsSelectable = useStore((s) => s.elementsSelectable);
  const nodesDraggable = useStore((s) => s.nodesDraggable);
  const nodesConnectable = useStore((s) => s.nodesConnectable);
  const setInteractive = useStore((s) => s.setNodesDraggable);
  const setNodesConnectable = useStore((s) => s.setNodesConnectable);
  const setElementsSelectable = useStore((s) => s.setElementsSelectable);
  const interactive = elementsSelectable && nodesDraggable && nodesConnectable;

  const toggleInteractivity = (): void => {
    const next = !interactive;
    setInteractive(next);
    setNodesConnectable(next);
    setElementsSelectable(next);
  };

  return (
    <div className="border-border bg-card divide-border absolute bottom-20 left-3 z-20 flex flex-col divide-y rounded-md border shadow-sm">
      <ControlButton
        label="Zoom in"
        onClick={() => {
          void zoomIn();
        }}
      >
        <Plus className="h-3.5 w-3.5" />
      </ControlButton>
      <ControlButton
        label="Zoom out"
        onClick={() => {
          void zoomOut();
        }}
      >
        <Minus className="h-3.5 w-3.5" />
      </ControlButton>
      <ControlButton
        label="Fit view"
        onClick={() => {
          void fitView({ padding: 0.2, duration: 250 });
        }}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </ControlButton>
      <ControlButton
        label={interactive ? "Lock canvas" : "Unlock canvas"}
        pressed={!interactive}
        onClick={toggleInteractivity}
      >
        {interactive ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
      </ControlButton>
    </div>
  );
}
