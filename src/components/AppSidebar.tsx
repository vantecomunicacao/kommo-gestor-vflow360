import { LayoutDashboard, Plug, Settings, LogOut, ShieldCheck, Snowflake, BarChart3 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePermissions, isSuggestionsOnly } from "@/contexts/PermissionsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { displayName, email, initial } = useProfile();
  const { permissions } = usePermissions();
  const { isAdmin, viewSuggestions, viewIntegrations, viewSettings } = permissions;
  // Vendedor (so sugestoes) nao ve os itens de gestor no menu.
  const gestor = !isSuggestionsOnly(permissions);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  // Fase 1 (produto de analytics Kommo): copiloto de IA (Analista/Conversas/
  // Sugestões) e observabilidade (Sistema/Logs) ficam fora do menu até a Fase 2.
  // Ver docs/ROADMAP_FASE2_COPILOTO.md.
  const navItems: { title: string; url: string; icon: typeof LayoutDashboard; show: boolean; end?: boolean }[] = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, show: gestor },
    { title: "Relatórios", url: "/relatorios", icon: BarChart3, show: gestor },
    { title: "Leads esfriando", url: "/cooling-leads", icon: Snowflake, show: viewSuggestions || isAdmin },
    { title: "Integrações", url: "/integrations", icon: Plug, show: viewIntegrations },
    { title: "Admin", url: "/admin", icon: ShieldCheck, show: isAdmin },
  ].filter((i) => i.show);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <div className="px-4 py-5 flex items-center justify-between gap-2">
        {collapsed ? (
          /* Colapsada: o próprio símbolo "V" vira o botão de reabrir o menu */
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="w-7 h-7 overflow-hidden shrink-0 rounded-md hover:bg-sidebar-accent transition-colors"
          >
            <>
              <img
                src="/vflow360-logo-barra.png"
                alt="VFlow360"
                className="h-7 max-w-none dark:hidden"
                style={{ objectFit: "cover", objectPosition: "left center", width: "auto" }}
              />
              <img
                src="/vflow360-logo-escuro.png"
                alt="VFlow360"
                className="h-7 max-w-none hidden dark:block"
                style={{ objectFit: "cover", objectPosition: "left center", width: "auto" }}
              />
            </>
          </button>
        ) : (
          <>
            <img src="/vflow360-logo-barra.png" alt="VFlow360" className="h-7 w-auto dark:hidden" />
            <img src="/vflow360-logo-escuro.png" alt="VFlow360" className="h-7 w-auto hidden dark:block" />
            <SidebarTrigger className="h-7 w-7 shrink-0 text-sidebar-foreground border border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          </>
        )}
      </div>

      {/* Workspace Selector */}
      <div className="px-3 pb-3">
        <WorkspaceSelector collapsed={collapsed} />
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end={item.end !== false}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                      activeClassName="gradient-primary text-white font-bold shadow-brand"
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 gap-2">
        {/* Usuário logado */}
        <div
          className={
            collapsed
              ? "flex justify-center"
              : "flex items-center gap-3 px-2 py-2 rounded-md bg-sidebar-accent/40"
          }
          title={collapsed ? displayName : undefined}
        >
          <div className="w-8 h-8 rounded-full gradient-primary text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
              {email && email !== displayName && (
                <p className="text-xs text-sidebar-foreground/75 truncate">{email}</p>
              )}
            </div>
          )}
        </div>
        <div className={collapsed ? "flex justify-center" : "px-1"}>
          <ThemeToggle placement="inline" />
        </div>
        <SidebarMenu>
          {viewSettings && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Configurações">
                <NavLink
                  to="/settings"
                  end={false}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                >
                  <Settings className="w-5 h-5 shrink-0" />
                  {!collapsed && <span>Configurações</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              tooltip="Sair"
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {!collapsed && <span>Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
