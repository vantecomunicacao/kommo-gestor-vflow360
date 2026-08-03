import { ChevronDown, Check, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function MultiFilterSelect({
  values, onChange, placeholder, pluralLabel, icon: Icon, options, className,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  pluralLabel: string;
  icon: typeof Users;
  options: { id: string; name: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Rascunho local: edita várias etapas com o menu aberto e só aplica ao fechar.
  const [draft, setDraft] = useState<string[]>(values);
  const hasSelection = values.length > 0;
  const toggle = (id: string) => {
    setDraft((d) => (d.includes(id) ? d.filter((v) => v !== id) : [...d, id]));
  };
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(values); // sincroniza ao abrir
    } else {
      const changed = draft.length !== values.length || draft.some((v) => !values.includes(v));
      if (changed) onChange(draft); // aplica (e atualiza dashboard) só ao fechar
    }
    setOpen(next);
  };
  const label = !hasSelection
    ? placeholder
    : values.length === 1
      ? (options.find((o) => o.id === values[0])?.name ?? placeholder)
      : `${values.length} ${pluralLabel}`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs font-medium border-border/60 hover:bg-accent/50 gap-2 px-3 w-auto min-w-[130px] max-w-[200px] justify-between",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
            hasSelection && "border-primary/40 bg-primary/5 text-foreground",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Icon className={cn("w-3.5 h-3.5 shrink-0", hasSelection ? "text-primary-ink" : "text-muted-foreground")} />
            <span className={cn("truncate", !hasSelection && "text-muted-foreground")}>{label}</span>
          </span>
          <ChevronDown className="w-3 h-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1 rounded-lg w-[220px]" align="start">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{placeholder}</span>
          {draft.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setDraft([])}
            >
              Limpar
            </button>
          )}
        </div>
        <div className="max-h-[260px] overflow-y-auto">
          {options.map((o) => {
            const checked = draft.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => toggle(o.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-accent/60 text-left"
              >
                <span className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                  checked ? "bg-primary border-primary text-primary-foreground" : "border-border"
                )}>
                  {checked && <Check className="w-3 h-3" />}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
