import { CalendarDays, Filter, Users, GitBranch, ChevronDown, Layers, X, Megaphone, Target, Check, Compass } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { format, subDays, startOfDay, endOfDay, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { Pipeline, User, CustomFilterDef } from "@/hooks/useKommoData";
import { cn } from "@/lib/utils";
import { MultiFilterSelect } from "@/components/filters/MultiFilterSelect";
import { countActiveFilters } from "@/lib/dashboard-filters";

interface HeaderProps {
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  onRefresh: (force?: boolean) => void;
  isLoading?: boolean;
  pipelines: Pipeline[];
  users: User[];
  selectedPipelineIds: string[];
  selectedStageIds?: string[];
  selectedSellerIds?: string[];
  utmMediumValues?: string[];
  utmCampaignValues?: string[];
  originValues?: string[];
  selectedUtmMediums?: string[];
  selectedUtmCampaigns?: string[];
  selectedOrigins?: string[];
  /** Filtros personalizados definidos em Configurações → Filtros. */
  customFilterDefs?: CustomFilterDef[];
  customFilterValues?: Record<string, string[]>;
  selectedCustomFilters?: Record<string, string[]>;
  onPipelineIdsChange: (ids: string[]) => void;
  onStageIdsChange?: (ids: string[]) => void;
  onSellerIdsChange?: (ids: string[]) => void;
  onUtmMediumsChange?: (v: string[]) => void;
  onUtmCampaignsChange?: (v: string[]) => void;
  onOriginsChange?: (v: string[]) => void;
  onCustomFilterChange?: (filterId: string, values: string[]) => void;
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

export function Header({
  dateRange, onDateRangeChange, onRefresh, isLoading,
  pipelines, users,
  selectedPipelineIds, selectedStageIds = [], selectedSellerIds = [],
  utmMediumValues = [], utmCampaignValues = [], originValues = [],
  selectedUtmMediums = [], selectedUtmCampaigns = [], selectedOrigins = [],
  customFilterDefs = [], customFilterValues = {}, selectedCustomFilters = {},
  onPipelineIdsChange, onStageIdsChange, onSellerIdsChange,
  onUtmMediumsChange, onUtmCampaignsChange, onOriginsChange, onCustomFilterChange,
  cachedAt,
  additionalDateRange, onAdditionalDateRangeChange, additionalDateLabel,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hasAdditionalRange = !!additionalDateRange?.from;
  const activeFilterCount = countActiveFilters({
    pipelineIds: selectedPipelineIds,
    stageIds: selectedStageIds,
    sellerIds: selectedSellerIds,
    utmMediums: selectedUtmMediums,
    utmCampaigns: selectedUtmCampaigns,
    origins: selectedOrigins,
    hasAdditionalRange,
    customFilters: selectedCustomFilters,
  });
  const showAdditional = !!additionalDateLabel && !!onAdditionalDateRangeChange;
  // Etapa só faz sentido com EXATAMENTE 1 funil selecionado: os ids de etapa se
  // repetem entre funis (ver funnel_stage_mapping) — combinar vários funis tornaria
  // a lista de etapas ambígua, então escondemos o filtro nesse caso.
  const singlePipeline = selectedPipelineIds.length === 1
    ? pipelines.find((p) => p.id === selectedPipelineIds[0])
    : undefined;
  const stages = singlePipeline?.stages || [];

  const clearAll = () => {
    onPipelineIdsChange([]);
    onStageIdsChange?.([]);
    onSellerIdsChange?.([]);
    onUtmMediumsChange?.([]);
    onUtmCampaignsChange?.([]);
    onOriginsChange?.([]);
    for (const def of customFilterDefs) onCustomFilterChange?.(def.id, []);
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
        <MultiFilterSelect
          values={selectedPipelineIds}
          onChange={onPipelineIdsChange}
          placeholder="Funil"
          pluralLabel="funis"
          icon={GitBranch}
          options={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        />
      </Field>

      {singlePipeline && stages.length > 0 && onStageIdsChange && (
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

      {onUtmMediumsChange && utmMediumValues.length > 0 && (
        <Field label="Tipo de origem">
          <MultiFilterSelect
            values={selectedUtmMediums}
            onChange={onUtmMediumsChange}
            placeholder="Tipo"
            pluralLabel="tipos"
            icon={Megaphone}
            options={utmMediumValues.map((v) => ({ id: v, name: v }))}
          />
        </Field>
      )}

      {onUtmCampaignsChange && utmCampaignValues.length > 0 && (
        <Field label="Campanha">
          <MultiFilterSelect
            values={selectedUtmCampaigns}
            onChange={onUtmCampaignsChange}
            placeholder="Campanha"
            pluralLabel="campanhas"
            icon={Target}
            options={utmCampaignValues.map((v) => ({ id: v, name: v }))}
          />
        </Field>
      )}

      {onOriginsChange && originValues.length > 0 && (
        <Field label="Origem">
          <MultiFilterSelect
            values={selectedOrigins}
            onChange={onOriginsChange}
            placeholder="Origem"
            pluralLabel="origens"
            icon={Compass}
            options={originValues.map((v) => ({ id: v, name: v }))}
          />
        </Field>
      )}

      {onCustomFilterChange && customFilterDefs.map((def) => {
        const options = customFilterValues[def.id] || [];
        if (options.length === 0) return null;
        return (
          <Field key={def.id} label={def.label}>
            <MultiFilterSelect
              values={selectedCustomFilters[def.id] || []}
              onChange={(v) => onCustomFilterChange(def.id, v)}
              placeholder={def.label}
              pluralLabel={def.label.toLowerCase()}
              icon={Filter}
              options={options.map((v) => ({ id: v, name: v }))}
            />
          </Field>
        );
      })}

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
