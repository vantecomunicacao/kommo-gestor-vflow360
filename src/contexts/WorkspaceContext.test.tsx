import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

// Reproduz a cadeia usada no contexto:
//   supabase.from("workspaces").select("*").is("deleted_at", null).order(...)
// Só o .order() dispara a chamada de rede (mockada).
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const p: Record<string, unknown> = {};
    p.select = () => p;
    p.is = () => p;
    p.order = () => queryMock();
    return p;
  };
  return { supabase: { from: () => chain() } };
});

// user precisa ser referencia ESTAVEL entre renders, senao o efeito
// (deps [user, authLoading]) reroda a cada render e nunca deixa o fetch terminar.
vi.mock("./AuthContext", () => {
  const mockUser = { id: "user-1" };
  return { useAuth: () => ({ user: mockUser, loading: false }) };
});

function Probe() {
  const { workspaces, activeWorkspace, loading } = useWorkspace();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{workspaces.length}</span>
      <span data-testid="active">{activeWorkspace?.name ?? "none"}</span>
    </div>
  );
}

const OK = {
  data: [
    { id: "ws-1", name: "Conta A", owner_id: "user-1", created_at: "2026-01-01", ai_analysis_enabled: false },
  ],
  error: null,
};

describe("WorkspaceContext - retry da busca de workspaces", () => {
  beforeEach(() => {
    queryMock.mockReset();
    localStorage.clear();
  });

  it("recupera a lista se a busca falhar nas primeiras tentativas (o bug: antes ficava com [] pra sempre)", async () => {
    queryMock
      .mockResolvedValueOnce({ data: null, error: { message: "token em transicao" } })
      .mockResolvedValueOnce({ data: null, error: { message: "token em transicao" } })
      .mockResolvedValueOnce(OK);

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"), { timeout: 4000 });

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("active").textContent).toBe("Conta A");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("para de carregar mesmo se todas as tentativas falharem (sem spinner infinito)", async () => {
    queryMock.mockResolvedValue({ data: null, error: { message: "falha persistente" } });

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"), { timeout: 4000 });

    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("resolve na primeira tentativa quando a busca funciona de primeira (caminho feliz)", async () => {
    queryMock.mockResolvedValueOnce(OK);

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    expect(screen.getByTestId("active").textContent).toBe("Conta A");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
