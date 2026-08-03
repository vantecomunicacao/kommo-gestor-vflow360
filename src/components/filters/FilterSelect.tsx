import { Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FilterSelect({
  value, onChange, placeholder, icon: Icon, options, className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  icon: typeof Users;
  options: { id: string; name: string }[];
  className?: string;
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
      <SelectTrigger
        className={cn(
          "h-8 text-xs font-medium border-border/60 hover:bg-accent/50 gap-2 px-3 w-auto min-w-[130px] max-w-[200px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
          selected && "border-primary/40 bg-primary/5 text-foreground",
          className
        )}
      >
        <Icon className={cn("w-3.5 h-3.5 shrink-0", selected ? "text-primary-ink" : "text-muted-foreground")} />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-lg">
        <SelectItem value="all">Todos</SelectItem>
        {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
