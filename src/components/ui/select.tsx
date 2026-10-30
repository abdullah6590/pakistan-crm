// src/components/ui/select.tsx
"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectContextValue {
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
  /** Labels of the options, so the closed box shows "Ali Traders" rather than the stored id */
  labels: React.MutableRefObject<Map<string, React.ReactNode>>;
  registered: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  listId: string;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelect() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>");
  return ctx;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value, onChange, children, disabled }: SelectProps) {
  const [open, setOpenState] = React.useState(false);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const labels = React.useRef(new Map<string, React.ReactNode>());
  const listId = React.useId();
  const setOpen = React.useCallback((next: boolean) => setOpenState(next && !disabled), [disabled]);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenState(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <SelectContext.Provider value={{ value, onChange, open, setOpen, disabled, labels, registered: bump, triggerRef, listRef, listId }}>
      <div ref={ref} className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function SelectTrigger({ children, className }: SelectTriggerProps) {
  const { open, setOpen, disabled, triggerRef, listId } = useSelect();
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
      }}
      className={cn(
        "flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
      <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", open && "rotate-180")} aria-hidden />
    </button>
  );
}

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

export function SelectValue({ placeholder, children }: SelectValueProps) {
  const { value, labels } = useSelect();
  if (children) {
    return <span className={cn("truncate", !value && "text-muted-foreground")}>{children}</span>;
  }
  const label = value ? labels.current.get(value) ?? value : null;
  return <span className={cn("truncate", !value && "text-muted-foreground")}>{label ?? placeholder ?? "Select..."}</span>;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

const options = (list: HTMLElement | null) => Array.from(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

export function SelectContent({ children, className }: SelectContentProps) {
  const { open, setOpen, triggerRef, listRef, listId } = useSelect();

  // Opening moves focus to the chosen option (or the first), so the arrow keys work straight away
  React.useEffect(() => {
    if (!open) return;
    const all = options(listRef.current);
    (all.find((o) => o.getAttribute("aria-selected") === "true") ?? all[0])?.focus();
  }, [open, listRef]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const all = options(listRef.current);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, i))]?.focus(); };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      // Escape closes only this list, not a dialog the select sits in
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  // Kept in the page while closed (hidden) so the closed box can show the chosen option's label
  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      hidden={!open}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute z-50 mt-1 max-h-72 w-full min-w-[8rem] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {children}
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function SelectItem({ value, children, className }: SelectItemProps) {
  const { value: selected, onChange, setOpen, labels, registered, triggerRef } = useSelect();
  const isSelected = selected === value;

  React.useLayoutEffect(() => {
    const known = labels.current.has(value);
    labels.current.set(value, children);
    if (!known) registered();
  }, [value, children, labels, registered]);
  React.useEffect(() => () => { labels.current.delete(value); }, [value, labels]);

  const choose = () => { onChange(value); setOpen(false); triggerRef.current?.focus(); };
  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={choose}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } }}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-md px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        isSelected && "bg-accent",
        className
      )}
    >
      <span className="flex-1">{children}</span>
      {isSelected && <Check className="ml-2 h-4 w-4" aria-hidden />}
    </div>
  );
}
