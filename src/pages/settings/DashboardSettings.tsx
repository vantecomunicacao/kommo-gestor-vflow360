import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FUNNEL_BUCKETS, DATE_TYPES } from "@/lib/dashboard-funnel";
import { SEGMENT_TEMPLATES, applyTemplateToSettings } from "@/lib/segment-templates";

interface Stage { id: string; name: string; }
interface Pipeline { id: string; kommo_id: string; name: string; stages: Stage[]; }
interface CustomField { id: string; kommo_id: string; name: string; code: string | null; field_type?: string | null; entity_type?: string | null; }

export default function DashboardSettings() {
  const { activeWorkspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ last_sync_at: string | null; last_sync_status: string | null; leads_count: number | null } | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [defaultPipelines, setDefaultPipelines] = useState<string[]>([]);
  const [stageMapping, setStageMapping] = useState<Record<string, string>>({}); // stageId -> bucket key
  const [utmSourceField, setUtmSourceField] = useState<string>("");
  const [utmMediumField, setUtmMediumField] = useState<string>("");
  const [utmCampaignField, setUtmCampaignField] = useState<string>("");
  const [utmContentField, setUtmContentField] = useState<string>("");
  const [utmTermField, setUtmTermField] = useState<string>("");
  const [originFieldName, setOriginFieldName] = useState<string>("");
  const [additionalDateField, setAdditionalDateField] = useState<string>("");
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  const [chartFields, setChartFields] = useState<string[]>([]);
  const [businessStart, setBusinessStart] = useState<string>("09:00");
  const [businessEnd, setBusinessEnd] = useState<string>("18:00");
  const [wonStageKeys, setWonStageKeys] = useState<string[]>(["venda_ganha"]);
  const [stageLabels, setStageLabels] = useState<Record<string, string>>({}); // bucket key -> rótulo customizado
  const [reportRateStages, setReportRateStages] = useState<string[]>([]); // etapas p/ taxas do relatório
  const [reportGoals, setReportGoals] = useState<Record<string, number>>({}); // metas do relatório ("<eixo>:<metricId>" -> valor)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Detecção de alterações não salvas (baseline capturado ao carregar / após salvar).
  const editable = useMemo(() => JSON.stringify({
    defaultPipelines, stageMapping, utmSourceField, utmMediumField, utmCampaignField,
    utmContentField, utmTermField, additionalDateField, originFieldName, visibleFields,
    chartFields, businessStart, businessEnd, wonStageKeys, stageLabels, reportRateStages, reportGoals,
  }), [defaultPipelines, stageMapping, utmSourceField, utmMediumField, utmCampaignField,
    utmContentField, utmTermField, additionalDateField, originFieldName, visibleFields,
    chartFields, businessStart, businessEnd, wonStageKeys, stageLabels, reportRateStages, reportGoals]);
  const baselineRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (baselineRef.current === null) { baselineRef.current = editable; setDirty(false); return; }
    setDirty(editable !== baselineRef.current);
  }, [editable, loading]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id]);

  const loadAll = async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    baselineRef.current = null; // recaptura o baseline após carregar (evita "sujo" ao trocar de conta)
    try {
      const [{ data: pipes }, { data: fields }, { data: settingsRow }, { data: status }] = await Promise.all([
        supabase.from("pipelines" as any).select("*").eq("workspace_id", activeWorkspace.id),
        supabase.from("custom_fields" as any).select("id,kommo_id,name,code,field_type,entity_type").eq("workspace_id", activeWorkspace.id),
        supabase.from("dashboard_settings" as any).select("*").eq("workspace_id", activeWorkspace.id).maybeSingle(),
        supabase.from("sync_status" as any).select("last_sync_at,last_sync_status,leads_count").eq("workspace_id", activeWorkspace.id).maybeSingle(),
      ]);
      setSyncStatus(status as any);
      // Kommo: etapas vivem em `statuses` (jsonb) dentro de cada pipeline.
      const ps = (pipes || []).map((p: any) => ({
        id: p.id, kommo_id: p.kommo_id, name: p.name,
        stages: (Array.isArray(p.statuses) ? p.statuses : []).map((s: any) => ({ id: String(s.id), name: s.name })),
      }));
      setPipelines(ps);
      setCustomFields((fields || []) as any);
      const settings = settingsRow as any;
      if (settings) {
        setDefaultPipelines(settings.default_pipeline_ids || []);
        setStageMapping((settings.funnel_stage_mapping as any) || {});
        setUtmSourceField((settings as any).utm_source_field_id || "");
        setUtmMediumField((settings as any).utm_medium_field_id || "");
        setUtmCampaignField((settings as any).utm_campaign_field_id || "");
        setUtmContentField((settings as any).utm_content_field_id || "");
        setUtmTermField((settings as any).utm_term_field_id || "");
        setAdditionalDateField(settings.additional_date_field || "");
        setOriginFieldName(settings.origin_field_name || "");
        setVisibleFields(settings.visible_custom_fields || []);
        setChartFields(settings.chart_custom_fields || []);
        setBusinessStart((settings as any).business_hours_start || "09:00");
        setBusinessEnd((settings as any).business_hours_end || "18:00");
        setWonStageKeys(settings.won_stage_keys || ["venda_ganha"]);
        setStageLabels((settings.funnel_stage_labels as any) || {});
        // report_rate_stages guarda CHAVES DE FASE; descarta valores legados (ids de etapa).
        setReportRateStages(((settings as any).report_rate_stages || []).filter((x: string) =>
          FUNNEL_BUCKETS.some((b) => b.key === x)));
        setReportGoals(((settings as any).report_goals as any) || {});
      }
    } catch (e) {
      toast.error("Erro ao carregar", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!activeWorkspace?.id) return;
    setSaving(true);
    try {
      const payload = {
        workspace_id: activeWorkspace.id,
        default_pipeline_ids: defaultPipelines,
        funnel_stage_mapping: stageMapping,
        utm_source_field_id: utmSourceField || null,
        utm_medium_field_id: utmMediumField || null,
        utm_campaign_field_id: utmCampaignField || null,
        utm_content_field_id: utmContentField || null,
        utm_term_field_id: utmTermField || null,
        additional_date_field: additionalDateField || null,
        origin_field_name: originFieldName || null,
        visible_custom_fields: visibleFields,
        chart_custom_fields: chartFields,
        business_hours_start: businessStart || "09:00",
        business_hours_end: businessEnd || "18:00",
        won_stage_keys: wonStageKeys,
        funnel_stage_labels: stageLabels,
        report_rate_stages: reportRateStages,
        report_goals: reportGoals,
      };
      const { error } = await supabase
        .from("dashboard_settings" as any)
        .upsert(payload as any, { onConflict: "workspace_id" });
      if (error) throw error;
      baselineRef.current = editable; // novo baseline = estado salvo
      setDirty(false);
      toast.success("Configurações salvas");
      // Recalcula as fotos do relatório (para refletir taxas de etapa recém-configuradas).
      supabase.functions.invoke("kommo-report-snapshot", { body: { workspace_id: activeWorkspace.id, months: 12 } })
        .catch(() => { /* silencioso: o cron diário também recalcula */ });
    } catch (e) {
      toast.error("Erro ao salvar", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    if (!activeWorkspace?.id) return;

    // Cooldown client-side de 2min por workspace
    const ckey = `kommo-sync-last:${activeWorkspace.id}`;
    const lastStr = localStorage.getItem(ckey);
    const last = lastStr ? Number(lastStr) : 0;
    const elapsed = Date.now() - last;
    const COOLDOWN = 2 * 60 * 1000;
    if (last && elapsed < COOLDOWN) {
      const wait = Math.ceil((COOLDOWN - elapsed) / 1000);
      toast.warning("Aguarde para sincronizar", {
        description: `Você pode sincronizar novamente em ${wait}s.`,
      });
      return;
    }
    localStorage.setItem(ckey, String(Date.now()));

    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("kommo-sync", {
        body: { workspace_id: activeWorkspace.id },
      });
      if (error) throw error;
      const errMsg = (data as any)?.error;
      if (errMsg) {
        toast.warning("Sincronização", { description: errMsg });
      } else {
        toast.success("Sincronização concluída", { description: "Pipelines, campos, usuários e leads atualizados." });
      }
      await loadAll();
    } catch (e) {
      toast.error("Erro ao sincronizar", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  const applyTemplate = () => {
    const template = SEGMENT_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    // Se já houver rótulos, taxas ou metas configurados, confirma antes de sobrescrever.
    const hasExisting =
      Object.keys(stageLabels).length > 0 ||
      reportRateStages.length > 0 ||
      Object.keys(reportGoals).length > 0;
    if (hasExisting && !window.confirm(
      `Aplicar o template "${template.label}"? Isso substitui os rótulos das fases, as taxas do Relatório e as metas que ele define. Suas demais configurações não são afetadas. Nada é salvo até você clicar em Salvar.`
    )) return;
    const next = applyTemplateToSettings(template, { stageLabels, reportRateStages, reportGoals });
    setStageLabels(next.stageLabels);
    setReportRateStages(next.reportRateStages);
    setReportGoals(next.reportGoals);
    toast.success(`Template "${template.label}" aplicado`, {
      description: "Revise os campos abaixo e clique em Salvar para confirmar.",
    });
  };

  const togglePipeline = (kommo_id: string) => {
    setDefaultPipelines((prev) =>
      prev.includes(kommo_id) ? prev.filter((p) => p !== kommo_id) : [...prev, kommo_id]
    );
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

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (!activeWorkspace) {
    return <p className="text-muted-foreground">Selecione uma conta primeiro.</p>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Configurações do Dashboard</h1>
          <p className="text-muted-foreground text-sm">Personalize agregações e campos exibidos por conta</p>
          {syncStatus?.last_sync_at && (
            <p className="text-xs text-muted-foreground mt-1">
              Última sincronização:{" "}
              {formatDistanceToNow(new Date(syncStatus.last_sync_at), { addSuffix: true, locale: ptBR })}
              {typeof syncStatus.leads_count === "number" && ` · ${syncStatus.leads_count} leads`}
              {syncStatus.last_sync_status === "error" && " · ⚠️ erro"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={syncNow} disabled={syncing || saving}>
            {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sincronizar agora
          </Button>
          <Button onClick={save} disabled={saving || syncing}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </div>
      </div>

      {/* Template de segmento */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Template de segmento
          </CardTitle>
          <CardDescription>
            Ponto de partida rápido: escolha o segmento do seu negócio para pré-preencher os
            nomes das fases, as taxas do Relatório e as metas médias do setor. Tudo continua
            editável abaixo e nada é salvo até você clicar em <strong>Salvar</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Segmento</Label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger><SelectValue placeholder="Selecione um segmento" /></SelectTrigger>
                <SelectContent>
                  {SEGMENT_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="secondary" onClick={applyTemplate} disabled={!selectedTemplateId}>
              <Sparkles className="w-4 h-4 mr-2" />
              Aplicar template
            </Button>
          </div>
          {(() => {
            const t = SEGMENT_TEMPLATES.find((x) => x.id === selectedTemplateId);
            if (!t) return null;
            const labels = FUNNEL_BUCKETS.map((b) => t.stageLabels[b.key]).filter(Boolean);
            const rates = t.reportRateStages.map((k) => t.stageLabels[k] || FUNNEL_BUCKETS.find((b) => b.key === k)?.label);
            return (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
                <p className="text-muted-foreground">{t.description}</p>
                <p><span className="font-medium">Fases:</span> {labels.join(" → ")}</p>
                {rates.length > 0 && (
                  <p><span className="font-medium">Taxas no Relatório:</span> {rates.map((r) => `Taxa ${r}`).join(", ")}</p>
                )}
                <p><span className="font-medium">Metas pré-definidas:</span> {Object.keys(t.reportGoals).length}</p>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Pipeline padrão */}
      <Card>
        <CardHeader>
          <CardTitle>Funil padrão</CardTitle>
          <CardDescription>Selecione o funil que será aberto automaticamente no Dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelines.map((p) => (
            <label key={p.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="defaultPipeline"
                className="accent-primary"
                checked={defaultPipelines[0] === p.kommo_id}
                onChange={() => setDefaultPipelines([p.kommo_id])}
              />
              <span>{p.name}</span>
              <span className="text-xs text-muted-foreground">({p.stages.length} etapas)</span>
            </label>
          ))}
          {pipelines.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="radio"
                name="defaultPipeline"
                className="accent-primary"
                checked={defaultPipelines.length === 0}
                onChange={() => setDefaultPipelines([])}
              />
              <span className="text-sm text-muted-foreground">Sem padrão (mostrar todos)</span>
            </label>
          )}
          {pipelines.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pipeline sincronizado.</p>}
        </CardContent>
      </Card>

      {/* Nomes das etapas do funil */}
      <Card>
        <CardHeader>
          <CardTitle>Nomes das etapas do funil</CardTitle>
          <CardDescription>
            Personalize como cada uma das 4 fases aparece no card "Visão Geral - Funil de Passagem"
            do Dashboard. Deixe em branco para usar o nome padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {FUNNEL_BUCKETS.map((b) => (
            <div key={b.key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
              <Label className="text-sm font-medium text-muted-foreground">{b.label}</Label>
              <div className="md:col-span-2">
                <Input
                  value={stageLabels[b.key] ?? ""}
                  placeholder={b.label}
                  onChange={(e) =>
                    setStageLabels((prev) => {
                      const next = { ...prev };
                      const v = e.target.value;
                      if (v.trim()) next[b.key] = v;
                      else delete next[b.key];
                      return next;
                    })
                  }
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Mapeamento do funil */}
      <Card>
        <CardHeader>
          <CardTitle>Mapeamento do funil</CardTitle>
          <CardDescription>
            Associe cada etapa do CRM a uma das 4 fases do funil analítico. Etapas sem mapeamento são ignoradas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {pipelines.map((p) => (
            <div key={p.id} className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground border-b pb-1">
                {p.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">({p.stages.length} etapas)</span>
              </h4>
              {p.stages.map((s) => (
                <div key={s.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center pl-1">
                  <div className="text-sm">{s.name}</div>
                  <Select
                    value={stageMapping[s.id] || "__none__"}
                    onValueChange={(v) =>
                      setStageMapping((prev) => {
                        const next = { ...prev };
                        if (v === "__none__") delete next[s.id];
                        else next[s.id] = v;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Ignorar</SelectItem>
                      {FUNNEL_BUCKETS.map((b) => (
                        <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ))}
          {pipelines.length === 0 && <p className="text-sm text-muted-foreground">Sincronize pipelines primeiro.</p>}
        </CardContent>
      </Card>

      {/* Taxas de fase do Relatório */}
      <Card>
        <CardHeader>
          <CardTitle>Taxas de fase (Relatório)</CardTitle>
          <CardDescription>
            Escolha uma ou mais das 4 fases do funil para virarem taxas no Relatório (aba
            Comercial), ex.: "Taxa de Agendamento". Cada taxa = leads da safra do mês que
            alcançaram a fase ÷ leads criados no mês. Como as 4 fases são comuns a todos os
            funis, a taxa funciona corretamente inclusive em "Todos os funis". Use os nomes
            personalizados acima ("Nomes das etapas do funil") para adequar ao seu negócio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {FUNNEL_BUCKETS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 pl-1 text-sm cursor-pointer">
              <Checkbox
                checked={reportRateStages.includes(b.key)}
                onCheckedChange={(c) =>
                  setReportRateStages((prev) => c ? [...prev, b.key] : prev.filter((x) => x !== b.key))
                }
              />
              {stageLabels[b.key] || b.label}
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Etapas "ganhas" */}
      <Card>
        <CardHeader>
          <CardTitle>Etapas consideradas como "Ganho"</CardTitle>
          <CardDescription>Quais buckets do funil contam como Venda Ganha</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {FUNNEL_BUCKETS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={wonStageKeys.includes(b.key)}
                onCheckedChange={() =>
                  setWonStageKeys((prev) =>
                    prev.includes(b.key) ? prev.filter((k) => k !== b.key) : [...prev, b.key]
                  )
                }
              />
              <span>{b.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Origem do lead */}
      <Card>
        <CardHeader>
          <CardTitle>Origem do lead (opcional)</CardTitle>
          <CardDescription>
            Campo personalizado que indica a origem do lead. Quando configurado, ele tem prioridade sobre o UTM Source
            nos gráficos "Origem dos leads" e "Origem das vendas". Se não configurar, a origem cai no UTM Source.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={originFieldName || "__none__"} onValueChange={(v) => setOriginFieldName(v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="— não configurado —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— não configurado —</SelectItem>
              {customFields
                .filter((f) => (f.entity_type || "").toLowerCase() === "leads")
                .map((f) => (
                  <SelectItem key={f.id} value={f.code || f.kommo_id}>{f.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Campos UTM */}
      <Card>
        <CardHeader>
          <CardTitle>Campos UTM</CardTitle>
          <CardDescription>
            Mapeie quais campos personalizados do Kommo correspondem aos parâmetros UTM. Source e Campaign alimentam os pies "Origem dos leads" e "Origem das vendas" no dashboard. Medium é usado como filtro. Content e Term ficam disponíveis para análises detalhadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { key: "source", label: "UTM Source", value: utmSourceField, setter: setUtmSourceField, hint: "Plataforma (ex.: google, facebook, instagram)" },
            { key: "medium", label: "UTM Medium", value: utmMediumField, setter: setUtmMediumField, hint: "Tipo de mídia (ex.: cpc, social, organic, email)" },
            { key: "campaign", label: "UTM Campaign", value: utmCampaignField, setter: setUtmCampaignField, hint: "Campanha específica (ex.: black-friday, lançamento-x)" },
            { key: "content", label: "UTM Content", value: utmContentField, setter: setUtmContentField, hint: "Variação criativa / anúncio (ex.: video-30s-v2, carrossel-azul)" },
            { key: "term", label: "UTM Term", value: utmTermField, setter: setUtmTermField, hint: "Público-alvo, palavra-chave ou segmentação (ex.: lookalike-1pct)" },
          ].map((utm) => (
            <div key={utm.key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
              <div>
                <Label className="text-sm font-medium">{utm.label}</Label>
                <p className="text-xs text-muted-foreground">{utm.hint}</p>
              </div>
              <div className="md:col-span-2">
                <Select value={utm.value || "__none__"} onValueChange={(v) => utm.setter(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione um campo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— não configurado —</SelectItem>
                    {customFields
                      .filter((f) => (f.entity_type || "").toLowerCase() === "leads")
                      .map((f) => (
                        <SelectItem key={f.id} value={f.code || f.kommo_id}>{f.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
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

      {/* Horário comercial (tempo de resposta) */}
      <Card>
        <CardHeader>
          <CardTitle>Horário comercial (tempo de resposta)</CardTitle>
          <CardDescription>
            Período em que sua equipe está disponível. O cálculo de "Tempo médio de resposta" do dashboard
            ignora o tempo fora desse intervalo (ex: cliente manda mensagem de madrugada e o vendedor responde de manhã).
            {" "}<strong>Por padrão, sábados, domingos e feriados nacionais brasileiros não são contabilizados.</strong>
            {" "}Para expediente que vira a noite (ex: 18h às 09h), basta inverter os horários.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="bh-start" className="text-xs">Início</Label>
            <input
              id="bh-start"
              type="time"
              value={businessStart}
              onChange={(e) => setBusinessStart(e.target.value)}
              className="h-10 px-3 rounded-xl border border-input bg-background text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bh-end" className="text-xs">Fim</Label>
            <input
              id="bh-end"
              type="time"
              value={businessEnd}
              onChange={(e) => setBusinessEnd(e.target.value)}
              className="h-10 px-3 rounded-xl border border-input bg-background text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground basis-full">
            Atual: <span className="font-bold">{businessStart || "09:00"}</span> às <span className="font-bold">{businessEnd || "18:00"}</span>
          </p>
        </CardContent>
      </Card>

      {/* Campo de data adicional */}
      <Card>
        <CardHeader>
          <CardTitle>Campo de data adicional (opcional)</CardTitle>
          <CardDescription>
            Quando configurado, o dashboard ganha um segundo filtro de período (somado ao período principal).
            Recomendado: <strong>Data da venda (fechamento ganho)</strong> — usa a data nativa do Kommo, sem
            precisar de campo personalizado nem preenchimento manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const dateFields = customFields.filter((f) =>
              f.field_type ? DATE_TYPES.includes(f.field_type) : false
            );
            return (
              <Select
                value={additionalDateField || "__none__"}
                onValueChange={(v) => setAdditionalDateField(v === "__none__" ? "" : v)}
              >
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {/* Nativos do Kommo (closed_at) — não exigem campo personalizado */}
                  <SelectItem value="__closed_won__">Data da venda (fechamento ganho)</SelectItem>
                  <SelectItem value="__closed_lost__">Data da perda (fechamento perdido)</SelectItem>
                  {dateFields.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Campos personalizados (data)</SelectLabel>
                      {dateFields.map((f) => (
                        <SelectItem key={f.id} value={f.kommo_id}>{f.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            );
          })()}
        </CardContent>
      </Card>

      {/* Barra flutuante de salvar — aparece quando há alterações não salvas */}
      {dirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-border bg-card/95 backdrop-blur-sm shadow-lg px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm text-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Alterações não salvas
          </span>
          <Button size="sm" onClick={save} disabled={saving || syncing} className="h-8">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </div>
      )}
    </div>
  );
}
