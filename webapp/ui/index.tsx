"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { X, HelpCircle, Inbox, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
  {
    variants: {
      variant: {
        primary: "bg-accent-solid text-white hover:brightness-110 active:brightness-95",
        ghost: "border border-line bg-surface hover:bg-raised active:bg-raised text-ink",
        subtle: "text-muted hover:bg-raised active:bg-raised hover:text-ink",
        danger: "border border-negative/40 text-negative hover:bg-negative/10 active:bg-negative/10",
        icon: "text-muted hover:bg-raised hover:text-ink",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-surface", className)} {...props} />;
}
export function CardHead({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 border-b border-rule px-4 py-2.5", className)} {...props} />;
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

type ChipTone = "ok" | "warn" | "bad" | "muted" | "accent";
const chipTone: Record<ChipTone, string> = {
  ok: "border-ok/30 text-ok bg-ok/10",
  warn: "border-warn/30 text-warn bg-warn/10",
  bad: "border-bad/30 text-bad bg-bad/10",
  muted: "border-line text-muted bg-raised",
  accent: "border-accent/30 text-accent bg-accent/10",
};
export function Chip({
  tone = "muted",
  className,
  children,
  title,
}: {
  tone?: ChipTone;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs leading-5",
        chipTone[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 bg-canvas px-3 py-2 text-left text-xs font-normal text-muted",
        className
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-rule px-3 py-2 align-top", className)} {...props} />;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "h-9 w-full rounded-md border border-control bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-raised disabled:opacity-60";

export function Term({ term, desc }: { term: string; desc: string }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={`${term}：${desc}`}
          onClick={(e) => e.currentTarget.focus()}
          className="inline-flex cursor-help items-center gap-0.5 rounded-sm border-b border-dotted border-muted text-inherit focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          {term}
          <HelpCircle className="h-3 w-3 opacity-60" />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={4}
          className="z-50 max-w-[260px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-ink shadow-overlay"
        >
          {desc}
          <Tooltip.Arrow className="fill-[rgb(var(--line))]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface shadow-overlay focus:outline-none">
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
            <Dialog.Title className="min-w-0 truncate text-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close asChild>
              <Button variant="icon" size="icon" aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="max-h-[70vh] overflow-y-auto scroll-thin px-4 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-rule px-4 py-3">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Section({
  title,
  meta,
  icon,
  defaultOpen = false,
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {icon}
        <span className="min-w-0 truncate">{title}</span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {meta && <span className="min-w-0 truncate text-xs font-normal text-muted">{meta}</span>}
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>
      <div id={id} hidden={!open} className={cn("border-t border-rule", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function Empty({
  title,
  action,
  icon,
}: {
  title: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="rounded-full bg-raised p-3 text-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="max-w-[420px] text-sm leading-relaxed text-muted">{title}</p>
      {action}
    </div>
  );
}

const ToastCtx = React.createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);
  const push = React.useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {msg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-canvas shadow-overlay">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => React.useContext(ToastCtx);

export type ViewKey = "data" | "eval" | "chat" | "api" | "about";
const NAV: { key: ViewKey; label: string }[] = [
  { key: "data", label: "数据" },
  { key: "eval", label: "评测" },
  { key: "chat", label: "对话" },
  { key: "api", label: "API" },
  { key: "about", label: "关于" },
];

export function TopBar({
  view,
  onNav,
  status,
  right,
}: {
  view: ViewKey;
  onNav: (v: ViewKey) => void;
  status?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 sm:gap-3 sm:px-4">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-base font-semibold tracking-tight">Spec2Test</span>
        <span className="hidden text-xs text-muted md:inline">NR NTN 一致性用例生成</span>
      </div>
      <nav className="ml-2 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="主导航">
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => onNav(n.key)}
            aria-current={view === n.key ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-2 py-1.5 text-sm transition-colors sm:px-2.5",
              view === n.key
                ? "bg-active font-medium text-ink"
                : "text-muted hover:bg-raised hover:text-ink"
            )}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status}
        {right}
      </div>
    </header>
  );
}
