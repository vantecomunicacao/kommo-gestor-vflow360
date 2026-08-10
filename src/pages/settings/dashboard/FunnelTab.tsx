import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FUNNEL_BUCKETS, funnelStageKey, readStageBucket } from "@/lib/dashboard-funnel";

interface Stage { id: string; name: string; }
interface Pipeline { id: string; kommo_id: string; name: string; stages: Stage[]; }

interface FunnelTabProps {
  pipelines: Pipeline[];
  defaultPipelines: string[];
  setDefaultPipelines: React.Dispatch<React.SetStateAction<string[]>>;
  stageLabels: Record<string, string>;
  setStageLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  stageMapping: Record<string, string>;
  setStageMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  wonStageKeys: string[];
  setWonStageKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function FunnelTab({
  pipelines, defaultPipelines, setDefaultPipelines,
  stageLabels, setStageLabels, stageMapping, setStageMapping,
  wonStageKeys, setWonStageKeys,
}: FunnelTabProps) {
  return (
    <>
      {/* Pipeline padrão */}
      <Card>
        <CardHeader>
          <CardTitle>Funis do Dashboard</CardTitle>
          <CardDescription>
            Marque os funis comerciais que devem entrar nas métricas. Funis administrativos
            (base de contatos, fornecedores, roteamento interno) devem ficar desmarcados.
            Nenhum marcado = todos entram e todos aparecem pra escolher. Com algum marcado,
            só esses aparecem no seletor de funil do Dashboard, Relatórios e Leads Esfriando —
            os demais somem da lista (continuam disponíveis aqui e nas Métricas Personalizadas
            pra reconfigurar). Com um único funil marcado, ele já vem selecionado por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {pipelines.map((p) => (
            <label key={p.id} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={defaultPipelines.includes(p.kommo_id)}
                onCheckedChange={(c) =>
                  setDefaultPipelines((prev) =>
                    c ? [...prev, p.kommo_id] : prev.filter((id) => id !== p.kommo_id))
                }
              />
              <span>{p.name}</span>
              <span className="text-xs text-muted-foreground">({p.stages.length} etapas)</span>
            </label>
          ))}
          {pipelines.length > 0 && defaultPipelines.length === 0 && (
            <p className="pt-1 text-sm text-muted-foreground">
              Nenhum funil marcado — o Dashboard soma todos.
            </p>
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
            "Venda perdida" não aparece aqui: é uma etapa de saída (não uma fase progressiva) e já é tratada
            automaticamente pelo Dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {pipelines.map((p) => {
            // Etapa de sistema "Venda perdida" (id 143, igual em todo funil) fica fora do
            // seletor: mapeá-la pra uma fase produz um comportamento inconsistente (o
            // Dashboard força todo lead perdido pra "Contato Inicial" sem olhar esse
            // mapeamento, mas outros cálculos que também usam stageBucket — tempo por
            // etapa, contagem por vendedor, Métricas Personalizadas — obedeceriam).
            const mappableStages = p.stages.filter((s) => s.id !== "143");
            return (
            <div key={p.id} className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground border-b pb-1">
                {p.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">({mappableStages.length} etapas)</span>
              </h4>
              {mappableStages.map((s) => (
                <div key={s.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center pl-1">
                  <div className="text-sm">{s.name}</div>
                  <Select
                    value={readStageBucket(stageMapping, p.kommo_id, s.id) || "__none__"}
                    onValueChange={(v) =>
                      setStageMapping((prev) => {
                        // Grava sempre no formato novo (funil+etapa), que tem prioridade
                        // sobre a regra legada global — por isso ela não precisa sair.
                        // Em "Ignorar" a legada TEM que sair, senão voltaria a valer.
                        const next = { ...prev };
                        const key = funnelStageKey(p.kommo_id, s.id);
                        if (v === "__none__") { delete next[key]; delete next[s.id]; }
                        else next[key] = v;
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
            );
          })}
          {pipelines.length === 0 && <p className="text-sm text-muted-foreground">Sincronize pipelines primeiro.</p>}
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
    </>
  );
}
