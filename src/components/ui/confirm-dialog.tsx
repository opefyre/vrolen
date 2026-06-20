/**
 * VROL-40 — Confirm dialog primitive built on top of base Dialog.
 *
 * Replaces ad-hoc window.confirm() calls with a themed modal that
 * matches the rest of the app. Inline-confirm UIs (the per-row "Are
 * you sure?" rows used in the scenarios sheet) stay where they are —
 * this primitive is for one-shot destructive flows where a modal is
 * the right interruption (e.g. importing a bundle, deleting the active
 * scenario).
 */

import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Imperative variant: useConfirm() returns a function that resolves
 * with a boolean. Easier to call from button onClick than wiring up
 * open/close state by hand.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = (opts: {
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean> =>
    new Promise((resolve) => {
      setState({ ...opts, resolve });
    });

  const node = state ? (
    <ConfirmDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open && state) {
          state.resolve(false);
          setState(null);
        }
      }}
      title={state.title}
      {...(state.description !== undefined ? { description: state.description } : {})}
      {...(state.confirmLabel !== undefined ? { confirmLabel: state.confirmLabel } : {})}
      {...(state.cancelLabel !== undefined ? { cancelLabel: state.cancelLabel } : {})}
      {...(state.destructive !== undefined ? { destructive: state.destructive } : {})}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, node };
}
