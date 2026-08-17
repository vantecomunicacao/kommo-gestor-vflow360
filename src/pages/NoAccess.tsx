import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { LockKeyhole } from "lucide-react";

// Landing de quem esta autenticado mas nao tem nenhuma das 4 permissoes
// (view_cooling/view_dashboard/view_integrations/view_settings) nem e admin.
// Ver landingPath() em PermissionsContext.tsx.
const NoAccess = () => {
  const { user } = useAuth();

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <LockKeyhole className="w-5 h-5 text-muted-foreground" />
          <CardTitle>Sem acesso liberado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não tem nenhuma área liberada. Fale com um administrador
            para liberar acesso ao Dashboard, Leads esfriando, Integrações ou Configurações.
          </p>
          <p className="text-xs text-muted-foreground">
            Logado como: <span className="font-mono">{user?.email}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default NoAccess;
