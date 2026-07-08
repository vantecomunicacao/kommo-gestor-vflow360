import { lazy, Suspense, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { PermissionsProvider } from "@/contexts/PermissionsContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import PermissionGuard from "@/components/PermissionGuard";
import GestorGuard from "@/components/GestorGuard";
import AppLayout from "./components/AppLayout";
import SettingsLayout from "./components/SettingsLayout";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DashboardSkeleton,
  IntegrationsSkeleton,
  GenericPageSkeleton,
} from "@/components/skeletons/RouteSkeletons";

// Helper: envolve cada rota lazy com seu próprio Suspense fallback
const lazyRoute = (element: ReactNode, fallback: ReactNode) => (
  <Suspense fallback={fallback}>{element}</Suspense>
);

// Auth pages — leves, mantidos eager para evitar flash no login
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

// Lazy: rotas pesadas (recharts, listas, integrações, etc.)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CoolingLeads = lazy(() => import("./pages/CoolingLeads"));
const Integrations = lazy(() => import("./pages/Integrations"));
const AccountSettings = lazy(() => import("./pages/settings/AccountSettings"));
const AiSettings = lazy(() => import("./pages/settings/AiSettings"));
const DashboardSettings = lazy(() => import("./pages/settings/DashboardSettings"));
const Workspaces = lazy(() => import("./pages/Workspaces"));
const Admin = lazy(() => import("./pages/Admin"));
// Rotas do copiloto de IA (Sugestões, Conversas, Analista) e de observabilidade
// (Logs, Sistema) foram removidas do produto na Fase 1: dependem de ingestão de
// conversa/schema antigo ainda não migrados. Ver docs/ROADMAP_FASE2_COPILOTO.md.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ThemeToggle />
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <WorkspaceProvider>
              <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<GestorGuard>{lazyRoute(<Dashboard />, <DashboardSkeleton />)}</GestorGuard>} />
                <Route
                  path="/cooling-leads"
                  element={<PermissionGuard require="viewSuggestions">{lazyRoute(<CoolingLeads />, <GenericPageSkeleton />)}</PermissionGuard>}
                />
                <Route
                  path="/integrations"
                  element={<PermissionGuard require="viewIntegrations">{lazyRoute(<Integrations />, <IntegrationsSkeleton />)}</PermissionGuard>}
                />
                <Route
                  path="/settings"
                  element={<PermissionGuard require="viewSettings"><SettingsLayout /></PermissionGuard>}
                >
                  <Route index element={<Navigate to="/settings/account" replace />} />
                  <Route path="account" element={lazyRoute(<AccountSettings />, <GenericPageSkeleton />)} />
                  <Route path="workspace" element={lazyRoute(<Workspaces />, <GenericPageSkeleton />)} />
                  <Route path="ai" element={lazyRoute(<AiSettings />, <GenericPageSkeleton />)} />
                  <Route path="dashboard" element={lazyRoute(<DashboardSettings />, <GenericPageSkeleton />)} />
                </Route>
                <Route path="/workspaces" element={<Navigate to="/settings/workspace" replace />} />
                <Route path="/admin" element={<GestorGuard>{lazyRoute(<Admin />, <GenericPageSkeleton />)}</GestorGuard>} />
              </Route>
              <Route path="*" element={<NotFound />} />
              </Routes>
            </WorkspaceProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
