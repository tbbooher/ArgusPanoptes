import { cn } from "@/lib/cn";

const VARIANT_CLASSES = {
  default: "bg-gray-800 text-gray-300",
  blue: "bg-blue-900/50 text-blue-300",
  green: "bg-green-900/50 text-green-300",
  yellow: "bg-yellow-900/50 text-yellow-300",
  red: "bg-red-900/50 text-red-300",
  purple: "bg-purple-900/50 text-purple-300",
  pink: "bg-pink-900/50 text-pink-300",
} as const;

interface BadgeProps {
  children: React.ReactNode;
  variant?: keyof typeof VARIANT_CLASSES;
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

const AUDIENCE_VARIANT: Record<string, keyof typeof VARIANT_CLASSES> = {
  young_children: "green",
  middle_grade: "blue",
  young_adult: "yellow",
  adult: "red",
};

export function AudienceBadge({
  audience,
  label,
}: {
  audience: string;
  label: string;
}) {
  return (
    <Badge variant={AUDIENCE_VARIANT[audience] ?? "default"}>{label}</Badge>
  );
}

export function TopicBadge({ label }: { label: string }) {
  return <Badge variant="purple">{label}</Badge>;
}
