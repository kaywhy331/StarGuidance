"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@starguidance/design-system";

/**
 * A themed replacement for window.confirm. Built on the native <dialog> so
 * focus is trapped, Escape cancels, and focus returns to the opener.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string | undefined;
  busy?: boolean | undefined;
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      className="account-confirm-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      ref={dialogRef}
    >
      <div className="account-confirm-dialog__panel">
        <span aria-hidden="true" className="account-confirm-dialog__mark">
          ✦
        </span>
        <h2 id={titleId}>{title}</h2>
        <div className="account-confirm-dialog__body" id={bodyId}>
          {children}
        </div>
        {error ? (
          <p className="account-confirm-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-confirm-dialog__actions">
          <Button autoFocus disabled={busy} onClick={onCancel} variant="secondary">
            Keep it
          </Button>
          <Button disabled={busy} onClick={onConfirm} variant="danger">
            {busy ? (busyLabel ?? "Working…") : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
