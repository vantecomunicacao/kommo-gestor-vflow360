import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, X } from "lucide-react";
import {
  CustomMetric, MAX_CUSTOM_METRICS, MAX_STAGE_REFS_PER_SIDE, StageRef,
  stageRefKey, CUSTOM_METRIC_ICONS, DEFAULT_CUSTOM_METRIC_ICON, getCustomMetricIcon,
} from "@/lib/custom-metrics";

interface Stage { id: string; name: string; }
interface Pipeline { id: string; kommo_id: string; name: string; stages: Stage[]; }
interface CustomField { id: string; kommo_id: string; name: string; code: string | null; field_type?: string | null; entity_type?: string | null; }

interface MetricsReportTabProps {
  pipelines: Pipeline[];
  customFields: CustomField[];
  customMetrics: CustomMetric[];
  setCustomMetrics: React.Dispatch<React.SetStateAction<CustomMetric[]>>;
  visibleFields: string[];
  setVisibleFields: React.Dispatch<React.SetStateAction<string[]>>;
  chartFields: string[];
  setChartFields: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function MetricsReportTab({
  pipelines, customFields, customMetrics, setCustomMetrics,
  visibleFields, setVisibleFields, chartFields, setChartFields,
}: MetricsReportTabProps) {
  // Lista achatada de etapas ("Funil › Etapa") pra montar os seletores das Métricas
  // Personalizadas — cada opção carrega o par {pipelineId, statusId} que a métrica guarda.
  const stageOptions = useMemo(
    () => pipelines.flatMap((p) => p.stages.map((s) => ({
      key: `${p.kommo_id}:${s.id}`,
      label: `${p.name} › ${s.name}`,
      ref: { pipelineId: p.kommo_id, statusId: s.id } as StageRef,
    }))),
    [pipelines],
  );
  const stageLabel = (ref: StageRef) =>
    stageOptions.find((o) => o.ref.pipelineId === ref.pipelineId && o.ref.statusId === ref.statusId)?.label
    || `${ref.pipelineId}:${ref.statusId}`;

  const addCustomMetric = () => {
    if (customMetrics.length >= MAX_CUSTOM_METRICS) return;
    setCustomMetrics((prev) => [...prev, {
      id: crypto.randomUUID(), name: "", format: "percent", icon: DEFAULT_CUSTOM_METRIC_ICON,
      numerator: [], denominator: [], reportVisible: true,
    }]);
  };
  const removeCustomMetric = (id: string) => setCustomMetrics((prev) => prev.filter((m) => m.id !== id));
  const patchCustomMetric = (id: string, patch: Partial<CustomMetric>) =>
    setCustomMetrics((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const addStageRef = (metricId: string, side: "numerator" | "denominator", ref: StageRef) => {
    setCustomMetrics((prev) => prev.map((m) => {
      if (m.id !== metricId) return m;
      const list = m[side];
      if (list.length >= MAX_STAGE_REFS_PER_SIDE) return m;
      if (list.some((r) => stageRefKey(r) === stageRefKey(ref))) return m;
      return { ...m, [side]: [...list, ref] };
    }));
  };
  const removeStageRef = (metricId: string, side: "numerator" | "denominator", ref: StageRef) => {
    setCustomMetrics((prev) => prev.map((m) => (
      m.id === metricId ? { ...m, [side]: m[side].filter((r) => stageRefKey(r) !== stageRefKey(ref)) } : m
    )));
  };

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
            do Funil. Cada uma compara contagens de leads por etapa — ex.: <strong>Taxa de No Show</strong> =
            leads que <strong>passaram</strong> pela etapa "Agendamento" ÷ leads que <strong>estão</strong> em
            "Não compareceu". Deixe o segundo grupo de etapas vazio pra virar uma contagem simples
            (sem divisão).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {customMetrics.map((m, idx) => (
            <div key={m.id} className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="w-20 space-y-1">
                  <Label className="text-xs">Ícone</Label>
                  <Select
                    value={m.icon || DEFAULT_CUSTOM_METRIC_ICON}
                    onValueChange={(v) => patchCustomMetric(m.id, { icon: v as CustomMetric["icon"] })}
                  >
                    <SelectTrigger>
                      {(() => {
                        const IconPreview = getCustomMetricIcon(m.icon);
                        return <IconPreview className="w-4 h-4" />;
                      })()}
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
                <Button
                  type="button" variant="ghost" size="icon" className="mt-5 shrink-0"
                  onClick={() => removeCustomMetric(m.id)}
                  aria-label="Remover métrica"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={m.reportVisible !== false}
                  onCheckedChange={(c) => patchCustomMetric(m.id, { reportVisible: c !== false })}
                />
                Aparece no Relatório (tendência mensal, além do Dashboard ao vivo)
              </label>

              {/* Numerador: sempre "passaram por" */}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {m.format === "percent" ? "Passaram por (numerador)" : "Passaram por"}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {m.numerator.map((r) => (
                    <Badge key={stageRefKey(r)} variant="secondary" className="gap-1 pr-1">
                      {stageLabel(r)}
                      <button type="button" onClick={() => removeStageRef(m.id, "numerator", r)} aria-label="Remover etapa">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                {m.numerator.length < MAX_STAGE_REFS_PER_SIDE && (
                  <Select value="" onValueChange={(v) => {
                    const opt = stageOptions.find((o) => o.key === v);
                    if (opt) addStageRef(m.id, "numerator", opt.ref);
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Adicionar etapa" /></SelectTrigger>
                    <SelectContent>
                      {pipelines.map((p) => (
                        <SelectGroup key={p.id}>
                          <SelectLabel>{p.name}</SelectLabel>
                          {p.stages.map((s) => (
                            <SelectItem key={`${p.kommo_id}:${s.id}`} value={`${p.kommo_id}:${s.id}`}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Denominador: "estão em" — só faz sentido pra formato Taxa */}
              {m.format === "percent" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Estão em (denominador)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {m.denominator.map((r) => (
                      <Badge key={stageRefKey(r)} variant="secondary" className="gap-1 pr-1">
                        {stageLabel(r)}
                        <button type="button" onClick={() => removeStageRef(m.id, "denominator", r)} aria-label="Remover etapa">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {m.denominator.length < MAX_STAGE_REFS_PER_SIDE && (
                    <Select value="" onValueChange={(v) => {
                      const opt = stageOptions.find((o) => o.key === v);
                      if (opt) addStageRef(m.id, "denominator", opt.ref);
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Adicionar etapa" /></SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectGroup key={p.id}>
                            <SelectLabel>{p.name}</SelectLabel>
                            {p.stages.map((s) => (
                              <SelectItem key={`${p.kommo_id}:${s.id}`} value={`${p.kommo_id}:${s.id}`}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          ))}

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
