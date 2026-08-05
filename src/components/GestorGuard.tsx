import { Navigate } from "react-router-dom";
import { usePermissions, isSuggestionsOnly } from "@/contexts/PermissionsContext";
import { Loader2 } from "lucide-react";

// Bloqueia usuarios "so sugestoes" (vendedor) das rotas de gestor, redirecionando
// para /leads-esfriando (Sugestoes saiu do produto na Fase 1). Gestores/admins passam.
const GestorGuard = ({ children }: { children: React.ReactNode }) => {
  const { permissions, loading } = usePermissions();
  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isSuggestionsOnly(permissions)) {
    return <Navigate to="/leads-esfriando" replace />;
  }
  return <>{children}</>;
};

export default GestorGuard;
