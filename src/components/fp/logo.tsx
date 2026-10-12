import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2.5", className)}
      aria-label="FoodPulse home"
      aria-hidden="true"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-transparent" />
      {!compact && <span className="min-w-0" aria-hidden="true" />}
    </Link>
  );
}
