import { useState } from "react";
import { RefreshCw, Snowflake, GitBranch, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCoolingLeads } from "@/hooks/useCoolingLeads";
import { CoolingLeadsCard } from "@/components/dashboard/CoolingLeadsCard";
import { ErrorState } from "@/components/dashboard/ErrorState";
import { MultiFilterSelect } from "@/components/filters/MultiFilterSelect";

export default function CoolingLeads() {
  const { activeWorkspace } = useWorkspace();
  // Filtros de sessão (não persistidos) — só valem pra esta tela.
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const [sellerIds, setSellerIds] = useState<string[]>([]);
  const { data, isLoading, isFetching, error, refetch } = useCoolingLeads(
    activeWorkspace?.id || null,
    pipelineIds,
    sellerIds,
  );

  if (!activeWorkspace) {
    return <ErrorState error="Selecione uma conta para visualizar os leads esfriando." onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Barra de filtros fixa no topo (mesmo padrão do dashboard/relatórios) */}
      <div className="sticky top-0 -mx-6 -mt-6 mb-2 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-end gap-2 overflow-x-auto pl-14 pr-4 py-3 min-h-16">
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Funil de vendas</span>
            <MultiFilterSelect
              values={pipelineIds}
              onChange={setPipelineIds}
              placeholder="Funil"
              pluralLabel="funis"
              icon={GitBranch}
              options={data?.pipelines ?? []}
            />
          </div>

          <Separator orientation="vertical" className="h-10 hidden md:block self-end mb-1" />

          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/80 px-0.5">Vendedor</span>
            <MultiFilterSelect
              values={sellerIds}
              onChange={setSellerIds}
              placeholder="Vendedor"
              pluralLabel="vendedores"
              icon={Users}
              options={data?.users ?? []}
            />
          </div>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Snowflake className="w-6 h-6 text-primary-ink" />
            Leads esfriando
          </h1>
          <p className="text-muted-foreground">
            {data?.scope === "seller"
              ? "Suas oportunidades abertas sem atividade recente"
              : "Oportunidades abertas sem atividade recente"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 gap-1.5 text-xs shrink-0"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Atualizar leads esfriando"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} aria-hidden="true" />
          <span>Atualizar</span>
        </Button>
      </div>

      {error && !data ? (
        <ErrorState error={error.message} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="dashboard-section animate-pulse h-40" />
      ) : (
        <CoolingLeadsCard data={data} />
      )}
    </div>
  );
}
