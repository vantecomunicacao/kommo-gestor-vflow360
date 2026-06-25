// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Brain, ScrollText, GitCommitHorizontal, ArrowRight } from "lucide-react";

// ============================================================
// Hub do Sistema — área admin interna (só para o operador/Vante).
// Reúne, em um lugar só: qualidade da IA, log de decisões e saúde.
// Read-only: não executa nem altera nada. Cresce por abas.
// ============================================================

type SuggestionRow = {
  id: string;
  status: "pending" | "approved" | "rejected";
  type: string;
  prompt_version: string | null;
  created_at: string;
};

// Espelha docs/DECISIONS.md (fonte da verdade). Mantenha em sincronia ao
// adicionar uma decisão lá. Futuro: migrar para uma tabela system_decisions.
const DECISIONS: { date: string; title: string; what: string }[] = [
  {
    date: "2026-06-07",
    title: "C1: versionamento do prompt das sugestões",
    what: "Coluna suggestions.prompt_version + constante PROMPT_VERSION em ai-analyze-v2. Rastreabilidade para aprendizado offline.",
  },
  {
    date: "2026-06-07",
    title: "auto_approve passa a executar de verdade",
    what: "Pré-autorização explícita por tipo + execução via cron postgres→edge (retry ≤3). Contorna a regra edge→edge.",
  },
  {
    date: "2026-06-07",
    title: "Cérebro analítico (analista do conjunto)",
    what: "ai-snapshot (semanal, por funil) + ai-insights-generate (insights proativos no Dashboard).",
  },
  {
    date: "2026-06-07",
    title: "Evolution/Stevo 1.0 descomissionada",
    what: "Removidas em prod. GHL passou a ser fonte única. Só resta o mundo 2.0.",
  },
  {
    date: "2026-06-03",
    title: "Iniciativa de documentação IA-first",
    what: "4 docs em docs/ (ARCHITECTURE, CAPABILITIES, AI_DECISIONS, OBSERVABILITY). IA só sugere; aprendizado offline.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  approved: "Aprovadas",
  rejected: "Rejeitadas",
  pending: "Pendentes",
};

function pct(n: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

function AiQualityTab() {
  const { activeWorkspace } = useWorkspace();

  const { data, isLoading } = useQuery({
    queryKey: ["system-hub", "ai-quality", activeWorkspace?.id],
    queryFn: async (): Promise<SuggestionRow[]> => {
      if (!activeWorkspace) return [];
      const { data, error } = await supabase
        .from("suggestions")
        .select("id, status, type, prompt_version, created_at")
        .eq("workspace_id", activeWorkspace.id)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as SuggestionRow[];
    },
    enabled: !!activeWorkspace,
  });

  const stats = useMemo(() => {
    const rows = data || [];
    const total = rows.length;
    const byStatus = { approved: 0, rejected: 0, pending: 0 } as Record<string, number>;
    const byVersion = new Map<string, { total: number; approved: number; rejected: number }>();
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const key = r.prompt_version || "(sem versão — antes do versionamento)";
      const v = byVersion.get(key) || { total: 0, approved: 0, rejected: 0 };
      v.total += 1;
      if (r.status === "approved") v.approved += 1;
      if (r.status === "rejected") v.rejected += 1;
      byVersion.set(key, v);
    }
    const versioned = rows.filter((r) => r.prompt_version).length;
    return { total, byStatus, byVersion: [...byVersion.entries()], versioned };
  }, [data]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!stats.total) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma sugestão nesta conta ainda. Conforme a IA gerar sugestões, as métricas de
          qualidade aparecem aqui.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {stats.versioned === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          ⏳ <strong>Acumulando dados versionados.</strong> O versionamento do prompt começou
          agora — as sugestões existentes não têm versão. As próximas já virão marcadas, e a
          comparação por versão fica útil em algumas semanas.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{stats.total}</CardContent>
        </Card>
        {(["approved", "rejected", "pending"] as const).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{STATUS_LABEL[s]}</CardTitle></CardHeader>
            <CardContent>
              <span className="text-2xl font-bold">{stats.byStatus[s] || 0}</span>
              <span className="text-sm text-muted-foreground ml-2">{pct(stats.byStatus[s] || 0, stats.total)}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Por versão de prompt</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead className="text-right">Sugestões</TableHead>
                <TableHead className="text-right">Taxa de aprovação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byVersion.map(([version, v]) => (
                <TableRow key={version}>
                  <TableCell className="font-mono text-xs">{version}</TableCell>
                  <TableCell className="text-right">{v.total}</TableCell>
                  <TableCell className="text-right">{pct(v.approved, v.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Taxa de aprovação = aprovadas ÷ total da versão. "Editou antes de aprovar" entra
            numa próxima etapa (instrumentação de backend).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Log de decisões</CardTitle>
        <p className="text-sm text-muted-foreground">
          Histórico datado das mudanças relevantes. Fonte: <span className="font-mono">docs/DECISIONS.md</span>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {DECISIONS.map((d, i) => (
          <div key={i} className="flex gap-3">
            <Badge variant="outline" className="h-fit shrink-0 font-mono text-xs">{d.date}</Badge>
            <div>
              <p className="font-medium text-sm">{d.title}</p>
              <p className="text-sm text-muted-foreground">{d.what}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HealthTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Saúde do sistema</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Erros e avisos das funções de backend e do app ficam na tela de Logs.</p>
        <Link
          to="/admin/logs"
          className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
        >
          Abrir logs do sistema <ArrowRight className="w-4 h-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

export default function SystemHub() {
  const { isAdmin, loading } = useIsAdmin();

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sistema</h1>
        <p className="text-sm text-muted-foreground">
          Painel interno: qualidade da IA, decisões e saúde. Só você (admin) vê isto.
        </p>
      </div>

      <Tabs defaultValue="ai-quality">
        <TabsList>
          <TabsTrigger value="ai-quality"><Brain className="w-4 h-4 mr-2" />Qualidade da IA</TabsTrigger>
          <TabsTrigger value="decisions"><GitCommitHorizontal className="w-4 h-4 mr-2" />Decisões</TabsTrigger>
          <TabsTrigger value="health"><ScrollText className="w-4 h-4 mr-2" />Saúde</TabsTrigger>
        </TabsList>
        <TabsContent value="ai-quality" className="mt-6"><AiQualityTab /></TabsContent>
        <TabsContent value="decisions" className="mt-6"><DecisionsTab /></TabsContent>
        <TabsContent value="health" className="mt-6"><HealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}
