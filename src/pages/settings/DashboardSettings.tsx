import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FUNNEL_BUCKETS } from "@/lib/dashboard-funnel";
import { SEGMENT_TEMPLATES, applyTemplateToSettings } from "@/lib/segment-templates";
import { CustomMetric, customMetricsListSchema } from "@/lib/custom-metrics";
import FunnelTab from "./dashboard/FunnelTab";
import OriginUtmTab from "./dashboard/OriginUtmTab";
import MetricsReportTab from "./dashboard/MetricsReportTab";
import PreferencesTab from "./dashboard/PreferencesTab";

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
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>([]);

  // Detecção de alterações não salvas (baseline capturado ao carregar / após salvar).
  const editable = useMemo(() => JSON.stringify({
    defaultPipelines, stageMapping, utmSourceField, utmMediumField, utmCampaignField,
    utmContentField, utmTermField, additionalDateField, originFieldName, visibleFields,
    chartFields, businessStart, businessEnd, wonStageKeys, stageLabels, reportRateStages, reportGoals,
    customMetrics,
  }), [defaultPipelines, stageMapping, utmSourceField, utmMediumField, utmCampaignField,
    utmContentField, utmTermField, additionalDateField, originFieldName, visibleFields,
    chartFields, businessStart, businessEnd, wonStageKeys, stageLabels, reportRateStages, reportGoals,
    customMetrics]);
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
        // Só funis vivos: arquivado/apagado no Kommo não deve aparecer p/ configurar.
        supabase.from("pipelines" as any).select("*")
          .eq("workspace_id", activeWorkspace.id).eq("is_archive", false).eq("is_deleted", false),
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
        // Descarta entradas malformadas em vez de quebrar a tela (ex.: editado direto no banco).
        const parsedMetrics = customMetricsListSchema.safeParse((settings as any).custom_metrics ?? []);
        setCustomMetrics(parsedMetrics.success ? parsedMetrics.data : []);
      }
    } catch (e) {
      toast.error("Erro ao carregar", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!activeWorkspace?.id) return;
    const metricsCheck = customMetricsListSchema.safeParse(customMetrics);
    if (!metricsCheck.success) {
      toast.error("Métricas Personalizadas com erro", {
        description: metricsCheck.error.errors[0]?.message || "Revise os campos das métricas.",
      });
      return;
    }
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
        custom_metrics: customMetrics,
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

      <Tabs defaultValue="funil" className="space-y-6">
        <TabsList>
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="origem">Origem &amp; UTM</TabsTrigger>
          <TabsTrigger value="metricas">Métricas &amp; Relatório</TabsTrigger>
          <TabsTrigger value="preferencias">Preferências</TabsTrigger>
        </TabsList>

        <TabsContent value="funil" className="space-y-6 mt-0">
          <FunnelTab
            pipelines={pipelines}
            defaultPipelines={defaultPipelines}
            setDefaultPipelines={setDefaultPipelines}
            stageLabels={stageLabels}
            setStageLabels={setStageLabels}
            stageMapping={stageMapping}
            setStageMapping={setStageMapping}
            wonStageKeys={wonStageKeys}
            setWonStageKeys={setWonStageKeys}
          />
        </TabsContent>

        <TabsContent value="origem" className="space-y-6 mt-0">
          <OriginUtmTab
            customFields={customFields}
            originFieldName={originFieldName}
            setOriginFieldName={setOriginFieldName}
            utmSourceField={utmSourceField}
            setUtmSourceField={setUtmSourceField}
            utmMediumField={utmMediumField}
            setUtmMediumField={setUtmMediumField}
            utmCampaignField={utmCampaignField}
            setUtmCampaignField={setUtmCampaignField}
            utmContentField={utmContentField}
            setUtmContentField={setUtmContentField}
            utmTermField={utmTermField}
            setUtmTermField={setUtmTermField}
          />
        </TabsContent>

        <TabsContent value="metricas" className="space-y-6 mt-0">
          <MetricsReportTab
            pipelines={pipelines}
            customFields={customFields}
            customMetrics={customMetrics}
            setCustomMetrics={setCustomMetrics}
            stageLabels={stageLabels}
            reportRateStages={reportRateStages}
            setReportRateStages={setReportRateStages}
            visibleFields={visibleFields}
            setVisibleFields={setVisibleFields}
            chartFields={chartFields}
            setChartFields={setChartFields}
          />
        </TabsContent>

        <TabsContent value="preferencias" className="space-y-6 mt-0">
          <PreferencesTab
            customFields={customFields}
            additionalDateField={additionalDateField}
            setAdditionalDateField={setAdditionalDateField}
          />
        </TabsContent>
      </Tabs>

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
