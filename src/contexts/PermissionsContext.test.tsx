import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PermissionsProvider, usePermissions } from "./PermissionsContext";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// user precisa ser uma referencia ESTAVEL entre renders (mesmo objeto), senao
// o efeito de PermissionsContext (deps [user, authLoading]) reroda a cada
// render e nunca deixa o fetch terminar.
vi.mock("./AuthContext", () => {
  const mockUser = { id: "user-1" };
  return {
    useAuth: () => ({ user: mockUser, loading: false }),
  };
});

function Probe() {
  const { permissions, loading } = usePermissions();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="isAdmin">{String(permissions.isAdmin)}</span>
      <span data-testid="viewSettings">{String(permissions.viewSettings)}</span>
    </div>
  );
}

describe("PermissionsContext - retry do get_my_permissions", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("recupera as permissoes reais se a RPC falhar nas primeiras tentativas (o bug: antes ficava preso em DEFAULT)", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { message: "auth.uid() nulo / token em transicao" } })
      .mockResolvedValueOnce({ data: null, error: { message: "auth.uid() nulo / token em transicao" } })
      .mockResolvedValueOnce({
        data: [{ view_suggestions: false, view_integrations: true, view_settings: true, is_admin: true }],
        error: null,
      });

    render(
      <PermissionsProvider>
        <Probe />
      </PermissionsProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"), { timeout: 4000 });

    expect(screen.getByTestId("isAdmin").textContent).toBe("true");
    expect(screen.getByTestId("viewSettings").textContent).toBe("true");
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("cai no padrao (tudo false) se todas as tentativas falharem, mas sem travar loading", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "falha persistente" } });

    render(
      <PermissionsProvider>
        <Probe />
      </PermissionsProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"), { timeout: 4000 });

    expect(screen.getByTestId("isAdmin").textContent).toBe("false");
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("resolve na primeira tentativa quando a RPC funciona de primeira (caminho feliz nao regrediu)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ view_suggestions: false, view_integrations: false, view_settings: true, is_admin: false }],
      error: null,
    });

    render(
      <PermissionsProvider>
        <Probe />
      </PermissionsProvider>
    );

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    expect(screen.getByTestId("viewSettings").textContent).toBe("true");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
