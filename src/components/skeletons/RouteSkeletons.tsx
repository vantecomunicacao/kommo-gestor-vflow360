import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton para o Dashboard: reflete a estrutura real (header + 5 KPIs + funil + vendedor + origens + qualidade + etc.).
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-300">
      {/* Header (filtros) */}
      <div className="-mx-6 -mt-6 mb-2 bg-card/95 border-b border-border">
        <div className="flex items-center gap-2 pl-14 pr-4 py-3 min-h-16">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32 hidden lg:block" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28 hidden sm:block" />
          </div>
        </div>
      </div>

      {/* Título */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* 5 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
        ))}
      </div>

      {/* Funil + AIInsights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-4">
          <Skeleton className="h-6 w-64" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" style={{ opacity: 1 - i * 0.15 }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>

      {/* Vendedor (tabela) */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-6 w-56" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-5 w-8" />
            <Skeleton className="h-5 flex-1 max-w-[160px]" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-5 w-16 ml-auto" />
          </div>
        ))}
      </div>

      {/* DailyLeads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-4">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <Skeleton className="h-6 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Origens (3 cards) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-3">
            <Skeleton className="h-6 w-40" />
            <div className="flex justify-center py-4">
              <Skeleton className="h-32 w-32 rounded-full" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Qualidade + Resposta */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-3">
          <Skeleton className="h-6 w-56" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 py-2">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-3 flex flex-col items-center justify-center">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-14 w-32 mt-4" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      {/* TimePerStage */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <Skeleton className="h-6 w-56" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        ))}
      </div>

      {/* AI Usage */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton para Sugestões: header com filtros + lista de acordeões agrupados por contato.
 */
export function SuggestionsSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 flex-1 min-w-[200px] max-w-md" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Acordeões de contatos */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1 min-w-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton para Integrações: cards de integração (Kommo) com status e ações.
 */
export function IntegrationsSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Cards de integração */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-px w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton genérico para rotas mais simples (Settings, Workspaces, Admin, Docs).
 */
export function GenericPageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton para Conversations: lista lateral + área de chat.
 */
export function ConversationsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-8rem)] animate-in fade-in duration-300">
      {/* Lista de conversas */}
      <div className="rounded-lg border bg-card p-3 space-y-3 overflow-hidden">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="space-y-2 flex-1 min-w-0">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>

      {/* Área de chat */}
      <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-hidden">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-12 w-1/2 ml-auto" />
          <Skeleton className="h-16 w-3/5" />
          <Skeleton className="h-12 w-2/5 ml-auto" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
