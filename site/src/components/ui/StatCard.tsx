import { cn } from "@/lib/cn";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}

export function StatCard({ label, value, subtitle, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-800 bg-gray-900 p-6",
        className,
      )}
    >
      <p className="text-sm font-medium text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-white font-mono">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      )}
    </div>
  );
}
