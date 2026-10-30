// src/components/ui/dialog.tsx
"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** The dialog's title id, so screen readers announce "Cancel SI-0001?" when it opens. */
const TitleContext = React.createContext<string | undefined>(undefined);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, children }: DialogProps) {
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const close = React.useRef(onClose);
  React.useEffect(() => { close.current = onClose; }, [onClose]);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Focus goes into the dialog when it opens, stays inside it while open, and returns to where it was when it closes
  React.useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const first = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find((el) => !el.dataset.dialogClose);
    (first ?? panel.current)?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-20">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0"
        onClick={onClose}
        aria-hidden
      />
      {/* Content */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-50 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border bg-background p-6 shadow-lg mx-4 outline-none animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-dialog-close="true"
          className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <TitleContext.Provider value={titleId}>{children}</TitleContext.Provider>
      </div>
    </div>
  );
}

export function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 pr-8", className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  const id = React.useContext(TitleContext);
  return <h2 id={id} className={cn("text-lg font-semibold leading-none tracking-tight", className)}>{children}</h2>;
}

export function DialogDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground mt-1", className)}>{children}</p>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2 mt-6", className)}>{children}</div>;
}
