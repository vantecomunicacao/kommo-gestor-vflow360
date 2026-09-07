// Error Boundary global — captura erros de render que hoje deixam a tela branca.
// Mostra uma tela amigável + botão de recarregar e reporta pro errorReporter
// (mesmo canal do window.onerror). Mantido dependência-leve DE PROPÓSITO (só
// React + Tailwind, nada de shadcn/ui): se o erro veio de um componente de UI
// compartilhado, importar esse componente aqui poderia re-disparar a falha.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errorReporter";

// Mesmo conjunto de padrões do errorReporter.ts — um chunk que falhou ao
// carregar quase sempre é "deploy novo, aba velha": a mensagem e a ação mudam.
const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /loading chunk \S+ failed/i,
  /chunkloaderror/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];
const isChunkLoadError = (msg: string | undefined | null): boolean =>
  !!msg && CHUNK_LOAD_PATTERNS.some((p) => p.test(msg));

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  isChunkError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, isChunkError: isChunkLoadError(msg) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (isChunkLoadError(err.message)) return; // "nova versão" — não é bug a reportar
    void reportError({
      source: "frontend:ErrorBoundary",
      message: err.message || "Erro de render não identificado",
      stack: err.stack,
      context: { componentStack: info.componentStack ?? undefined },
    });
  }

  private handleReload = () => window.location.reload();

  render() {
    if (!this.state.hasError) return this.props.children;

    const { isChunkError } = this.state;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-foreground">
            {isChunkError ? "Nova versão disponível" : "Algo deu errado"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isChunkError
              ? "O sistema foi atualizado enquanto esta aba estava aberta. Recarregue para carregar a versão mais recente."
              : "Ocorreu um erro inesperado nesta tela. O problema foi registrado. Tente recarregar a página."}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Recarregar página
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
