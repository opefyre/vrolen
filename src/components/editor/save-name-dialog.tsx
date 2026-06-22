/**
 * VROL-812 — inline scenario-name dialog for the Cmd+S save flow.
 *
 * When the user hits Cmd/Ctrl+S on an Untitled scenario, this dialog
 * auto-opens, traps focus to a single Input, accepts Enter to submit and
 * Esc to cancel, and hands the trimmed name back through `onSubmit`. It
 * replaces the prior `window.prompt`-style confirm so the editor stays
 * inside the shadcn dialog primitive set.
 */

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface SaveNameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called with the trimmed name when the user confirms. */
  readonly onSubmit: (name: string) => void;
  /** Pre-fill, e.g. an inferred name from the canvas. */
  readonly initialName?: string;
}

/**
 * Inner body is rendered only when the dialog is open so React unmounts
 * the form on close — that resets the name draft automatically without a
 * setState-in-effect.
 */
function SaveNameDialogBody({
  initialName,
  onSubmit,
  onCancel,
}: {
  readonly initialName: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState<string>(initialName);
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  // Callback ref — focuses the input on first mount + selects so the user
  // can immediately overwrite the seed. Avoids `autoFocus` (a11y rule) +
  // dodges the setState-in-effect reset pattern.
  const focusRef = useCallback((el: HTMLInputElement | null) => {
    if (el !== null) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit(trimmed);
      }}
    >
      <Input
        ref={focusRef}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        placeholder="e.g. Filler line v1"
        aria-label="Scenario name"
        data-testid="save-name-input"
        autoComplete="off"
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit} data-testid="save-name-submit">
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SaveNameDialog({
  open,
  onOpenChange,
  onSubmit,
  initialName = "",
}: SaveNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="save-name-dialog">
        <DialogHeader>
          <DialogTitle>Name this scenario</DialogTitle>
          <DialogDescription>
            Give your scenario a name to save it. You can rename it later from the scenarios drawer.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SaveNameDialogBody
            initialName={initialName}
            onSubmit={(name) => {
              onSubmit(name);
              onOpenChange(false);
            }}
            onCancel={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
