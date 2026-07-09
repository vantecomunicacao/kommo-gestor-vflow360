import { CalendarDays, Filter, Users, GitBranch, ChevronDown, Layers, X, Megaphone, Target, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Pipeline, User } from "@/hooks/useKommoData";
import { cn } from "@/lib/utils";

interface HeaderProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  onRefresh: (force?: boolean) => void;
  isLoading?: boolean;
  pipelines: Pipeline[];
  users: User[];
  selectedPipelineId: string | null;
  selectedStageIds?: string[];
  selectedSellerIds?: string[];
  utmMediumValues?: string[];
  utmCampaignValues?: string[];
  selectedUtmMedium?: string | null;
  selectedUtmCampaign?: string | null;
  onPipelineChange: (id: string | null) => void;
  onStageIdsChange?: (ids: string[]) => void;
  onSellerIdsChange?: (ids: string[]) => void;
  onUtmMediumChange?: (v: string | null) => void;
  onUtmCampaignChange?: (v: string | null) => void;
  cachedAt?: string | null;
  additionalDateRange?: DateRange | undefined;
  onAdditionalDateRangeChange?: (r: DateRange | undefined) => void;
  additionalDateLabel?: string | null;
}

const datePresets = [
  { label: "Hoje", getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: "Ontem", getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
  { label: "Últimos 7 dias", getValue: () => ({ from: subDays(new Date(), 7), to: subDays(new Date(), 1) }) },
  { label: "Últimos 30 dias", getValue: () => ({ from: subDays(new Date(), 30), to: subDays(new Date(), 1) }) },
  { label: "Últimos 90 dias", getValue: () => ({ from: subDays(new Date(), 90), to: subDays(new Date(), 1) }) },
  { label: "Este mês", getValue: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Mês passado", getValue: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: "Este ano", getValue: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

// Se o período atual corresponde exatamente a um atalho, devolve o rótulo dele.
function matchingPresetLabel(range: DateRange | undefined): string | null {
  if (!range?.from || !range?.to) return null;
  const sameDay = (a?: Date, b?: Date) =>
    !!a && !!b && format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd");
  const match = datePresets.find((p) => {
    const v = p.getValue();
    return sameDay(v.from, range.from) && sameDay(v.to, range.to);
  });
  return match?.label ?? null;
}

function formatRangeLabel(range: DateRange | undefined) {
  if (!range?.from) return null;
  if (!range.to) return format(range.from, "dd MMM yyyy", { locale: ptBR });
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  return sameYear
    ? `${format(range.from, "dd MMM", { locale: ptBR })} – ${format(range.to, "dd MMM, yyyy", { locale: ptBR })}`
    : `${format(range.from, "dd MMM yyyy", { locale: ptBR })} – ${format(range.to, "dd MMM yyyy", { locale: ptBR })}`;
}

function DateRangePicker({
  dateRange, onDateRangeChange, label, placeholder = "Período", icon: Icon = CalendarDays, className, clearable = false,
}: {
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  label?: string;
  placeholder?: string;
  icon?: typeof CalendarDays;
  className?: string;
  clearable?: boolean;
}) {
  const [localRange, setLocalRange] = useState<DateRange | undefined>(dateRange);
  const [open, setOpen] = useState(false);
  useEffect(() => setLocalRange(dateRange), [dateRange]);

  const handleConfirm = () => {
    if (localRange?.from && localRange?.to) {
      onDateRangeChange(localRange);
      setOpen(false);
    }
  };

  const labelText = matchingPresetLabel(dateRange) ?? formatRangeLabel(dateRange);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 h-8 text-xs font-medium border-border/60 hover:bg-accent/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
            className
          )}
        >
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          {labelText ? (
            <span className="truncate">
              {label && <span className="text-muted-foreground mr-1">{label}:</span>}
              {labelText}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          {clearable && labelText && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar período"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDateRangeChange(undefined);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onDateRangeChange(undefined);
                  setOpen(false);
                }
              }}
              className="ml-1 p-0.5 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent style={{ width: "fit-content" }} className="p-0 rounded-xl" align="start">
        <div className="flex">
          <div className="border-r border-border p-1.5 pr-3 space-y-0.5 w-[140px]">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-2 py-1.5">Atalhos</p>
            {datePresets.map((p) => {
              const v = p.getValue();
              const sameDay = (a?: Date, b?: Date) =>
                !!a && !!b && format(a, "yyyy-MM-dd") === format(b, "yyyy-MM-dd");
              const active = sameDay(v.from, dateRange?.from) && sameDay(v.to, dateRange?.to);
              return (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  aria-pressed={active}
                  className={cn(
                    "w-full justify-start text-xs h-7 px-2 rounded-md font-normal gap-1.5",
                    active && "bg-primary/10 text-primary font-semibold hover:bg-primary/15",
                  )}
                  onClick={() => { setLocalRange(v); onDateRangeChange(v); setOpen(false); }}
                >
                  <Check className={cn("w-3 h-3 shrink-0", active ? "opacity-100" : "opacity-0")} />
                  {p.label}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-col">
            <Calendar
              initialFocus mode="range"
              defaultMonth={localRange?.from}
              selected={localRange}
              onSelect={setLocalRange}
              numberOfMonths={2}
              locale={ptBR}
              className="pointer-events-auto p-2"
            />
            <div className="flex justify-between items-center p-3 pt-0 border-t border-border/40 mt-2">
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button size="sm" className="rounded-md h-7 text-xs" disabled={!localRange?.from || !localRange?.to} onClick={handleConfirm}>
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

export function Header({
  dateRange, onDateRangeChange, onRefresh, isLoading,
  pipelines, users,
  selectedPipelineId, selectedStageIds = [], selectedSellerIds = [],
  utmMediumValues = [], utmCampaignValues = [],
  selectedUtmMedium = null, selectedUtmCampaign = null,
  onPipelineChange, onStageIdsChange, onSellerIdsChange,
  onUtmMediumChange, onUtmCampaignChange,
  cachedAt,
  additionalDateRange, onAdditionalDateRangeChange, additionalDateLabel,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasAdditionalRange = !!additionalDateRange?.from;
  const activeFilterCount = [selectedPipelineId, selectedStageIds.length > 0, selectedSellerIds.length > 0, selectedUtmMedium, selectedUtmCampaign, hasAdditionalRange].filter(Boolean).length;
  const showAdditional = !!additionalDateLabel && !!onAdditionalDateRangeChange;
  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const stages = selectedPipeline?.stages || [];

  const clearAll = () => {
    onPipelineChange(null);
    onStageIdsChange?.([]);
    onSellerIdsChange?.([]);
    onUtmMediumChange?.(null);
    onUtmCampaignChange?.(null);
    onAdditionalDateRangeChange?.(undefined);
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">
        {label}
      </span>
      {children}
    </div>
  );

  const filterControls = (
    <>
      <Field label="Período">
        <DateRangePicker dateRange={dateRange} onDateRangeChange={onDateRangeChange} />
      </Field>

      <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />

      <Field label="Funil de vendas">
        <FilterSelect
          value={selectedPipelineId}
          onChange={onPipelineChange}
          placeholder="Funil"
          icon={GitBranch}
          options={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        />
      </Field>

      {selectedPipelineId && stages.length > 0 && onStageIdsChange && (
        <Field label="Etapa">
          <MultiFilterSelect
            values={selectedStageIds}
            onChange={onStageIdsChange}
            placeholder="Etapa"
            pluralLabel="etapas"
            icon={Layers}
            options={stages.map((s) => ({ id: s.id, name: s.name }))}
          />
        </Field>
      )}

      {onSellerIdsChange && (
        <Field label="Vendedor">
          <MultiFilterSelect
            values={selectedSellerIds}
            onChange={onSellerIdsChange}
            placeholder="Vendedor"
            pluralLabel="vendedores"
            icon={Users}
            options={users.map((u) => ({ id: u.id, name: u.name }))}
          />
        </Field>
      )}

      {onUtmMediumChange && utmMediumValues.length > 0 && (
        <Field label="Tipo de origem">
          <FilterSelect
            value={selectedUtmMedium}
            onChange={onUtmMediumChange}
            placeholder="Tipo"
            icon={Megaphone}
            options={utmMediumValues.map((v) => ({ id: v, name: v }))}
          />
        </Field>
      )}

      {onUtmCampaignChange && utmCampaignValues.length > 0 && (
        <Field label="Campanha">
          <FilterSelect
            value={selectedUtmCampaign}
            onChange={onUtmCampaignChange}
            placeholder="Campanha"
            icon={Target}
            options={utmCampaignValues.map((v) => ({ id: v, name: v }))}
          />
        </Field>
      )}

      {showAdditional && (
        <>
          <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />
          <Field label={additionalDateLabel!}>
            <DateRangePicker
              dateRange={additionalDateRange}
              onDateRangeChange={onAdditionalDateRangeChange!}
              clearable
            />
          </Field>
        </>
      )}
    </>
  );

  return (
    <header className="sticky top-0 -mx-6 -mt-6 mb-2 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-2 pl-14 pr-4 py-3 min-h-16">
        {/* Mobile: filtros em sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="lg:hidden h-8 gap-2 text-xs">
              <Filter className="w-3.5 h-3.5" />
              Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground rounded-full">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-3 mt-4 pb-4">
              {filterControls}
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs" onClick={clearAll}>
                  <X className="w-3.5 h-3.5 mr-1" /> Limpar todos
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Desktop: filtros inline */}
        <div className="hidden lg:flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          {filterControls}

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
              onClick={clearAll}
            >
              <X className="w-3.5 h-3.5" /> Limpar
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
