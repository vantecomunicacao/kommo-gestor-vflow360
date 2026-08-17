import { Navigate } from "react-router-dom";
import { usePermissions, landingPath } from "@/contexts/PermissionsContext";
import { Loader2 } from "lucide-react";

type PermKey = "viewCooling" | "viewDashboard" | "viewIntegrations" | "viewSettings";

const PermissionGuard = ({
  require,
  children,
}: {
  require: PermKey;
  children: React.ReactNode;
}) => {
  const { permissions, loading } = usePermissions();
  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Admin passa por qualquer permissão exigida (gestor enxerga tudo).
  if (!permissions[require] && !permissions.isAdmin) {
    return <Navigate to={landingPath(permissions)} replace />;
  }
  return <>{children}</>;
};

export default PermissionGuard;
