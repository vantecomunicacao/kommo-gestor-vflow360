import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboardFilterHydration } from "./useDashboardFilterHydration";

// Deferred: permite controlar exatamente quando a consulta ao Supabase
// "responde", pra inspecionar o estado do hook ENQUANTO ela ainda está
// pendente (reproduz a corrida real: trocar de workspace enquanto a
// hidratação do anterior ainda não voltou).
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const { maybeSingleMock } = vi.hoisted(() => ({ maybeSingleMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: (...args: unknown[]) => maybeSingleMock(...args),
        }),
      }),
    }),
  },
}));

describe("useDashboardFilterHydration - troca de workspace (achado 2026-08-17)", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("limpa os filtros e 'hydrated' de forma síncrona ao trocar de workspace, antes da consulta ao Supabase do workspace novo responder", async () => {
    const wsA = deferred<{ data: { default_pipeline_ids: string[]; funnel_stage_labels: Record<string, string> } }>();
    const wsB = deferred<{ data: { default_pipeline_ids: string[]; funnel_stage_labels: Record<string, string> } }>();
    maybeSingleMock.mockReturnValueOnce(wsA.promise).mockReturnValueOnce(wsB.promise);

    const searchParams = new URLSearchParams();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useDashboardFilterHydration(workspaceId, searchParams),
      { initialProps: { workspaceId: "ws-a" } },
    );

    await act(async () => {
      wsA.resolve({ data: { default_pipeline_ids: [], funnel_stage_labels: {} } });
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    // Usuário seleciona um funil no workspace A.
    act(() => { result.current.setSelectedPipelineIds(["pipeline-do-workspace-a"]); });
    expect(result.current.selectedPipelineIds).toEqual(["pipeline-do-workspace-a"]);

    // Troca para o workspace B — a consulta de configurações dele ainda não respondeu.
    rerender({ workspaceId: "ws-b" });

    // Mesmo SEM esperar a resposta do workspace B, o filtro do workspace A não
    // pode continuar selecionado: é exatamente essa combinação (workspace novo
    // + filtro do workspace antigo) que fazia o dashboard buscar com um id de
    // funil que não existe no workspace novo e voltar tudo zerado.
    expect(result.current.hydrated).toBe(false);
    expect(result.current.selectedPipelineIds).toEqual([]);
    expect(result.current.selectedStageIds).toEqual([]);
    expect(result.current.selectedSellerIds).toEqual([]);
    expect(result.current.selectedCustomFilters).toEqual({});

    // Resolve a consulta do workspace B — hidrata de verdade (sem filtro salvo).
    await act(async () => {
      wsB.resolve({ data: { default_pipeline_ids: [], funnel_stage_labels: {} } });
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.selectedPipelineIds).toEqual([]);
  });

  it("restaura o filtro salvo do PRÓPRIO workspace novo depois de trocar (não fica travado em vazio)", async () => {
    localStorage.setItem(
      "dashboard:filters:ws-b",
      JSON.stringify({ pipelineIds: ["pipeline-do-workspace-b"] }),
    );

    const wsA = deferred<{ data: { default_pipeline_ids: string[]; funnel_stage_labels: Record<string, string> } }>();
    const wsB = deferred<{ data: { default_pipeline_ids: string[]; funnel_stage_labels: Record<string, string> } }>();
    maybeSingleMock.mockReturnValueOnce(wsA.promise).mockReturnValueOnce(wsB.promise);

    const searchParams = new URLSearchParams();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useDashboardFilterHydration(workspaceId, searchParams),
      { initialProps: { workspaceId: "ws-a" } },
    );

    await act(async () => {
      wsA.resolve({ data: { default_pipeline_ids: [], funnel_stage_labels: {} } });
    });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    rerender({ workspaceId: "ws-b" });
    await act(async () => {
      wsB.resolve({ data: { default_pipeline_ids: [], funnel_stage_labels: {} } });
    });

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.selectedPipelineIds).toEqual(["pipeline-do-workspace-b"]);
  });
});
