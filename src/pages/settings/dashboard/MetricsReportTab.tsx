import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, X, ChevronsUpDown, ChevronDown, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import {
  CustomMetric, MAX_CUSTOM_METRICS, MAX_STAGE_REFS_PER_SIDE, StageRef, FieldRef, MetricRef,
  isFieldRef, metricRefKey, CUSTOM_METRIC_ICONS, DEFAULT_CUSTOM_METRIC_ICON, getCustomMetricIcon,
  CUSTOM_METRIC_COLORS, DEFAULT_CUSTOM_METRIC_COLOR, COUNT_MODE_OPTIONS,
} from "@/lib/custom-metrics";
import { cn } from "@/lib/utils";

interface Stage { id: string; name: string; }
interface Pipeline { id: string; kommo_id: string; name: string; stages: Stage[]; }
interface CustomFieldEnum { id: number; sort: number; value: string; }
interface CustomField {
  id: string; kommo_id: string; name: string; code: string | null;
  field_type?: string | null; entity_type?: string | null; enums?: CustomFieldEnum[] | null;
}

interface MetricsReportTabProps {
  pipelines: Pipeline[];
  customFields: CustomField[];
  customMetrics: CustomMetric[];
  setCustomMetrics: React.Dispatch<React.SetStateAction<CustomMetric[]>>;
  visibleFields: string[];
  setVisibleFields: React.Dispatch<React.SetStateAction<string[]>>;
  chartFields: string[];
  setChartFields: React.Dispatch<React.SetStateAction<string[]>>;
  /** Evento de etapa mais antigo sincronizado — vira a data no aviso do modo "histórico". */
  eventsHistorySince?: string | null;
}

// Seletor de etapa com busca (funil/etapa) — substitui o <Select> em árvore, que
// exigia abrir + rolar por grupo pra achar uma etapa quando há vários funis.
function StageCombobox({
  pipelines, disabledKeys, onSelect,
}: {
  pipelines: Pipeline[];
  disabledKeys: Set<string>;
  onSelect: (ref: StageRef) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" size="sm"
          className="h-8 w-full justify-between text-xs font-normal text-muted-foreground"
        >
          + Adicionar etapa
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar funil ou etapa..." className="text-sm" />
          <CommandList>
            <CommandEmpty>Nenhuma etapa encontrada.</CommandEmpty>
            {pipelines.map((p) => (
              <CommandGroup key={p.id} heading={p.name}>
                {p.stages.map((s) => {
                  const key = `${p.kommo_id}:${s.id}`;
                  const isDisabled = disabledKeys.has(key);
                  return (
                    <CommandItem
                      key={key}
                      value={`${p.name} ${s.name}`}
                      disabled={isDisabled}
                      onSelect={() => {
                        onSelect({ pipelineId: p.kommo_id, statusId: s.id });
                        setOpen(false);
                      }}
                    >
                      {s.name}
                      {isDisabled && <span className="ml-auto text-[10px] text-muted-foreground">já adicionada</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Seletor de campo personalizado. Campos select/multiselect COM valores
// cadastrados (`enums`) abrem um segundo passo pra escolher um valor
// específico (ou "qualquer valor preenchido"); qualquer outro tipo (checkbox,
// texto, data etc.) vira direto "campo preenchido" — não tem de onde vir uma
// lista de valores reais pra esses tipos.
function FieldRefCombobox({
  customFields, disabledFieldOnlyKeys, onSelect,
}: {
  customFields: CustomField[];
  /** fieldIds já adicionados como "qualquer valor preenchido" (sem sentido adicionar de novo). */
  disabledFieldOnlyKeys: Set<string>;
  onSelect: (ref: FieldRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingField, setPendingField] = useState<CustomField | null>(null);
  const leadFields = customFields.filter((f) => (f.entity_type || "").toLowerCase() === "leads");

  const fieldKey = (f: CustomField) => f.code || f.kommo_id;
  const hasEnumPicker = (f: CustomField) =>
    (f.field_type === "select" || f.field_type === "multiselect") && (f.enums?.length ?? 0) > 0;

  const commit = (field: CustomField, value?: string) => {
    onSelect({ fieldId: fieldKey(field), value });
    setOpen(false);
    setPendingField(null);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPendingField(null); }}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" size="sm"
          className="h-8 w-full justify-between text-xs font-normal text-muted-foreground"
        >
          + Adicionar campo
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          {pendingField ? (
            <>
              <CommandInput placeholder={`Valor de "${pendingField.name}"...`} className="text-sm" />
              <CommandList>
                <CommandEmpty>Nenhum valor encontrado.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="qualquer valor preenchido" onSelect={() => commit(pendingField)}>
                    Qualquer valor preenchido
                  </CommandItem>
                  {[...(pendingField.enums || [])].sort((a, b) => a.sort - b.sort).map((e) => (
                    <CommandItem key={e.id} value={e.value} onSelect={() => commit(pendingField, e.value)}>
                      {e.value}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </>
          ) : (
            <>
              <CommandInput placeholder="Buscar campo..." className="text-sm" />
              <CommandList>
                <CommandEmpty>Nenhum campo encontrado.</CommandEmpty>
                <CommandGroup>
                  {leadFields.map((f) => {
                    const isDisabled = disabledFieldOnlyKeys.has(fieldKey(f));
                    return (
                      <CommandItem
                        key={f.id}
                        value={f.name}
                        disabled={isDisabled}
                        onSelect={() => (hasEnumPicker(f) ? setPendingField(f) : commit(f))}
                      >
                        {f.name}
                        {isDisabled && <span className="ml-auto text-[10px] text-muted-foreground">já adicionado</span>}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function MetricsReportTab({
  pipelines, customFields, customMetrics, setCustomMetrics,
  visibleFields, setVisibleFields, chartFields, setChartFields, eventsHistorySince,
}: MetricsReportTabProps) {
  const eventsHistorySinceLabel = eventsHistorySince
    ? new Date(eventsHistorySince).toLocaleDateString("pt-BR")
    : null;
  const pipelineName = (pipelineId: string) =>
    pipelines.find((p) => p.kommo_id === pipelineId)?.name || pipelineId;
  const stageOnly = (ref: StageRef) =>
    pipelines.find((p) => p.kommo_id === ref.pipelineId)?.stages.find((s) => s.id === ref.statusId)?.name
    || ref.statusId;
  const fieldName = (fieldId: string) =>
    customFields.find((f) => (f.code || f.kommo_id) === fieldId)?.name || fieldId;
  const fieldValueLabel = (ref: FieldRef) => {
    if (!ref.value) return null;
    const f = customFields.find((c) => (c.code || c.kommo_id) === ref.fieldId);
    return f?.enums?.find((e) => e.value === ref.value)?.value ?? ref.value;
  };

  // Agrupa as badges de etapa de um lado (numerador/denominador) por funil, pra
  // ficar legível quando a métrica mistura etapas de funis diferentes.
  const groupByPipeline = (refs: StageRef[]) => {
    const groups = new Map<string, StageRef[]>();
    for (const r of refs) {
      const list = groups.get(r.pipelineId) ?? [];
      list.push(r);
      groups.set(r.pipelineId, list);
    }
    return Array.from(groups.entries());
  };
  const stageRefsOf = (m: CustomMetric, side: "numerator" | "denominator"): StageRef[] =>
    m[side].filter((r): r is StageRef => !isFieldRef(r));
  const fieldRefsOf = (m: CustomMetric, side: "numerator" | "denominator"): FieldRef[] =>
    m[side].filter(isFieldRef);

  // Colapsadas por padrão (visão só resume nome/ícone/cor); expande ao clicar.
  // Métrica recém-criada entra direto expandida (addCustomMetric cuida disso).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const addCustomMetric = () => {
    if (customMetrics.length >= MAX_CUSTOM_METRICS) return;
    const id = crypto.randomUUID();
    setCustomMetrics((prev) => [...prev, {
      id, name: "", format: "percent", icon: DEFAULT_CUSTOM_METRIC_ICON,
      color: DEFAULT_CUSTOM_METRIC_COLOR, numerator: [], denominator: [], reportVisible: true,
      countMode: "cascata",
    }]);
    setExpandedIds((prev) => new Set(prev).add(id));
  };
  const removeCustomMetric = (id: string) => setCustomMetrics((prev) => prev.filter((m) => m.id !== id));
  const patchCustomMetric = (id: string, patch: Partial<CustomMetric>) =>
    setCustomMetrics((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const moveCustomMetric = (id: string, direction: -1 | 1) =>
    setCustomMetrics((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      const swapWith = idx + direction;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  const addMetricRef = (metricId: string, side: "numerator" | "denominator", ref: MetricRef) => {
    setCustomMetrics((prev) => prev.map((m) => {
      if (m.id !== metricId) return m;
      const list = m[side];
      if (list.length >= MAX_STAGE_REFS_PER_SIDE) return m;
      if (list.some((r) => metricRefKey(r) === metricRefKey(ref))) return m;
      return { ...m, [side]: [...list, ref] };
    }));
  };
  const removeMetricRef = (metricId: string, side: "numerator" | "denominator", ref: MetricRef) => {
    setCustomMetrics((prev) => prev.map((m) => (
      m.id === metricId ? { ...m, [side]: m[side].filter((r) => metricRefKey(r) !== metricRefKey(ref)) } : m
    )));
  };
  // Mesma etapa/campo nos dois lados vira "sempre 100%" quando é o único em
  // cada lado (numerador == denominador) — sinal quase certo de config errada.
  const hasDuplicateStage = (m: CustomMetric) =>
    m.format === "percent" && m.numerator.some((n) => m.denominator.some((d) => metricRefKey(n) === metricRefKey(d)));

  const toggleField = (kommo_id: string) => {
    setVisibleFields((prev) => {
      const willRemove = prev.includes(kommo_id);
      if (willRemove) {
        // Campo não visível não pode ter pizza: tira do chart também.
        setChartFields((cf) => cf.filter((p) => p !== kommo_id));
        return prev.filter((p) => p !== kommo_id);
      }
      return [...prev, kommo_id];
    });
  };

  const toggleChartField = (kommo_id: string) => {
    setChartFields((prev) =>
      prev.includes(kommo_id) ? prev.filter((p) => p !== kommo_id) : [...prev, kommo_id]
    );
  };

  // Bloco de badges + botões de um lado (numerador/denominador) da métrica —
  // reaproveitado nas duas seções abaixo.
  const renderRefsEditor = (m: CustomMetric, side: "numerator" | "denominator") => {
    const stageRefs = stageRefsOf(m, side);
    const fieldRefs = fieldRefsOf(m, side);
    const total = m[side].length;
    const fieldOnlyKeys = new Set(fieldRefs.filter((r) => !r.value).map((r) => r.fieldId));
    return (
      <div className="space-y-1.5">
        {stageRefs.length > 0 && (
          <div className="space-y-1">
            {groupByPipeline(stageRefs).map(([pid, refs]) => (
              <div key={pid} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground shrink-0">{pipelineName(pid)}:</span>
                {refs.map((r) => (
                  <Badge key={metricRefKey(r)} variant="secondary" className="gap-1 pr-1">
                    {stageOnly(r)}
                    <button type="button" onClick={() => removeMetricRef(m.id, side, r)} aria-label="Remover etapa">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        )}
        {fieldRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground shrink-0">Campo:</span>
            {fieldRefs.map((r) => (
              <Badge key={metricRefKey(r)} variant="secondary" className="gap-1 pr-1">
                {fieldName(r.fieldId)}{fieldValueLabel(r) ? ` = ${fieldValueLabel(r)}` : " (preenchido)"}
                <button type="button" onClick={() => removeMetricRef(m.id, side, r)} aria-label="Remover campo">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {total < MAX_STAGE_REFS_PER_SIDE && (
          <div className="flex gap-1.5">
            <StageCombobox
              pipelines={pipelines}
              disabledKeys={new Set(stageRefs.map((r) => `${r.pipelineId}:${r.statusId}`))}
              onSelect={(ref) => addMetricRef(m.id, side, ref)}
            />
            <FieldRefCombobox
              customFields={customFields}
              disabledFieldOnlyKeys={fieldOnlyKeys}
              onSelect={(ref) => addMetricRef(m.id, side, ref)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Métricas Personalizadas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Métricas Personalizadas
          </CardTitle>
          <CardDescription>
            Crie até {MAX_CUSTOM_METRICS} métricas próprias do seu negócio, exibidas no Dashboard ao lado
            do Funil. Cada uma compara contagens de leads por etapa e/ou campo personalizado — ex.:{" "}
            <strong>Taxa de No Show</strong> = leads que <strong>estão</strong> em "Agendamento" ÷ leads com o
            campo <strong>"Não compareceu"</strong> marcado. Deixe o segundo grupo vazio pra virar uma
            contagem simples (sem divisão). Depois de salvar, passe o mouse no ícone (i) do card no
            Dashboard pra ver os números exatos por trás do cálculo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {customMetrics.map((m, idx) => {
            const isExpanded = expandedIds.has(m.id);
            const MetricIcon = getCustomMetricIcon(m.icon);
            return (
              <div key={m.id} className="rounded-xl border border-border p-3 space-y-3">
                <div className="flex items-center gap-1">
                  <div className="flex flex-col shrink-0">
                    <Button
                      type="button" variant="ghost" size="icon" className="h-5 w-5"
                      disabled={idx === 0} onClick={() => moveCustomMetric(m.id, -1)}
                      aria-label="Mover métrica para cima"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button" variant="ghost" size="icon" className="h-5 w-5"
                      disabled={idx === customMetrics.length - 1} onClick={() => moveCustomMetric(m.id, 1)}
                      aria-label="Mover métrica para baixo"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(m.id)}
                    className="flex-1 flex items-center gap-2 text-left min-w-0 py-1"
                    aria-expanded={isExpanded}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0",
                        (m.color || DEFAULT_CUSTOM_METRIC_COLOR) === "accent" && "bg-accent",
                        m.color === "success" && "bg-success",
                        m.color === "warning" && "bg-warning",
                        m.color === "destructive" && "bg-destructive",
                      )}
                    />
                    <MetricIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{m.name || `Métrica ${idx + 1}`}</span>
                    <ChevronDown className={cn("w-4 h-4 ml-auto shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                  </button>
                  <Button
                    type="button" variant="ghost" size="icon" className="shrink-0"
                    onClick={() => removeCustomMetric(m.id)}
                    aria-label="Remover métrica"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-3 pt-1 border-t border-border">
                    <div className="flex items-start gap-2 pt-3">
                      <div className="w-20 space-y-1">
                        <Label className="text-xs">Ícone</Label>
                        <Select
                          value={m.icon || DEFAULT_CUSTOM_METRIC_ICON}
                          onValueChange={(v) => patchCustomMetric(m.id, { icon: v as CustomMetric["icon"] })}
                        >
                          <SelectTrigger>
                            <MetricIcon className="w-4 h-4" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CUSTOM_METRIC_ICONS).map(([key, { label, Icon }]) => (
                              <SelectItem key={key} value={key}>
                                <span className="flex items-center gap-2">
                                  <Icon className="w-4 h-4" /> {label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Nome da métrica</Label>
                        <Input
                          value={m.name}
                          placeholder={`Métrica ${idx + 1}`}
                          onChange={(e) => patchCustomMetric(m.id, { name: e.target.value })}
                        />
                      </div>
                      <div className="w-44 space-y-1">
                        <Label className="text-xs">Formato</Label>
                        <Select
                          value={m.format}
                          onValueChange={(v) => patchCustomMetric(m.id, { format: v as CustomMetric["format"] })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percent">Taxa (%)</SelectItem>
                            <SelectItem value="number">Contagem</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={m.reportVisible !== false}
                        onCheckedChange={(c) => patchCustomMetric(m.id, { reportVisible: c !== false })}
                      />
                      Aparece no Relatório (tendência mensal, além do Dashboard ao vivo)
                    </label>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Cor do card</Label>
                      <div className="flex items-center gap-2">
                        {Object.entries(CUSTOM_METRIC_COLORS).map(([key, { label }]) => (
                          <button
                            key={key}
                            type="button"
                            title={label}
                            aria-label={label}
                            aria-pressed={(m.color || DEFAULT_CUSTOM_METRIC_COLOR) === key}
                            onClick={() => patchCustomMetric(m.id, { color: key as CustomMetric["color"] })}
                            className={cn(
                              "h-6 w-6 rounded-full border-2 transition-transform",
                              key === "accent" && "bg-accent",
                              key === "success" && "bg-success",
                              key === "warning" && "bg-warning",
                              key === "destructive" && "bg-destructive",
                              (m.color || DEFAULT_CUSTOM_METRIC_COLOR) === key
                                ? "border-foreground scale-110"
                                : "border-transparent opacity-60 hover:opacity-100",
                            )}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground">
                          {CUSTOM_METRIC_COLORS[m.color || DEFAULT_CUSTOM_METRIC_COLOR].label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Escolha manual — não é calculado. Use vermelho pra métricas onde um número alto é ruim
                        (ex.: Taxa de No Show).
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo de contagem</Label>
                      <Select
                        value={m.countMode || "cascata"}
                        onValueChange={(v) => patchCustomMetric(m.id, { countMode: v as CustomMetric["countMode"] })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(COUNT_MODE_OPTIONS).map(([key, { label }]) => (
                            <SelectItem key={key} value={key}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {COUNT_MODE_OPTIONS[m.countMode || "cascata"].description}
                      </p>
                      {m.countMode === "historico" && (
                        <p className="flex items-center gap-1.5 text-xs text-warning-ink">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Esse modo só enxerga mudanças de etapa
                          {eventsHistorySinceLabel ? ` a partir de ${eventsHistorySinceLabel}` : " de um histórico curto"}
                          {" "}— é o limite de retenção da API do Kommo, não dá pra recuperar depois. Campo
                          personalizado não é afetado por essa janela (vale sempre o valor atual).
                        </p>
                      )}
                    </div>

                    {/* Numerador: sempre "passaram por" (etapa) ou "estão marcados com" (campo) */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {m.format === "percent" ? "Passaram por / têm o campo (numerador)" : "Passaram por / têm o campo"}
                      </Label>
                      {renderRefsEditor(m, "numerator")}
                    </div>

                    {/* Denominador — só faz sentido pra formato Taxa */}
                    {m.format === "percent" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Estão em / têm o campo (denominador)</Label>
                        {renderRefsEditor(m, "denominator")}
                      </div>
                    )}

                    {hasDuplicateStage(m) && (
                      <p className="flex items-center gap-1.5 text-xs text-warning-ink">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        A mesma etapa/campo está no numerador e no denominador — se forem os únicos de cada lado, o resultado é sempre 100%.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {customMetrics.length < MAX_CUSTOM_METRICS ? (
            <Button type="button" variant="outline" size="sm" onClick={addCustomMetric}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar métrica
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Limite de {MAX_CUSTOM_METRICS} métricas atingido.</p>
          )}
          {pipelines.length === 0 && (
            <p className="text-sm text-muted-foreground">Sincronize pipelines primeiro pra escolher etapas.</p>
          )}
        </CardContent>
      </Card>

      {/* Campos visíveis */}
      <Card>
        <CardHeader>
          <CardTitle>Campos customizados visíveis</CardTitle>
          <CardDescription>
            Quais campos contam na seção de Qualidade dos Dados. Apenas campos de <strong>Lead</strong> são exibidos
            — campos de Contato não são salvos nos leads do CRM e apareceriam sempre como 0% preenchidos.
            Marque <strong>"Gráfico de pizza"</strong> em um campo visível para também exibir a distribuição dos seus
            valores como um gráfico de pizza no dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-96 overflow-y-auto">
          {(() => {
            const leadFields = customFields.filter((f) => (f.entity_type || "").toLowerCase() === "leads");
            if (leadFields.length === 0) {
              return <p className="text-sm text-muted-foreground">Nenhum campo personalizado de lead sincronizado.</p>;
            }
            return leadFields.map((f) => {
              const isVisible = visibleFields.includes(f.kommo_id);
              const hasChart = chartFields.includes(f.kommo_id);
              return (
                <div key={f.id} className="flex items-center justify-between gap-4 py-1">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <Checkbox
                      checked={isVisible}
                      onCheckedChange={() => toggleField(f.kommo_id)}
                    />
                    <span className="truncate">{f.name}</span>
                    {f.code && <span className="text-xs text-muted-foreground hidden sm:inline">({f.code})</span>}
                    {f.field_type && <span className="text-xs text-muted-foreground hidden sm:inline">[{f.field_type}]</span>}
                  </label>
                  {isVisible && (
                    <label className="flex items-center gap-2 cursor-pointer shrink-0 text-xs text-muted-foreground">
                      <Checkbox
                        checked={hasChart}
                        onCheckedChange={() => toggleChartField(f.kommo_id)}
                      />
                      <span>Gráfico de pizza</span>
                    </label>
                  )}
                </div>
              );
            });
          })()}
          {visibleFields.some((id) => {
            const f = customFields.find((c) => c.kommo_id === id);
            return f && (f.entity_type || "").toLowerCase() !== "leads";
          }) && (
            <p className="text-xs text-warning-ink mt-3">
              ⚠ Há campos de Contato selecionados nas suas configurações antigas. Eles aparecerão sempre como 0%. Remova-os e selecione campos de Lead.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
