import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

function CollapsedOnlyTrigger() {
  const { state, isMobile } = useSidebar();
  if (!isMobile && state !== "collapsed") return null;
  return (
    <SidebarTrigger
      className="fixed top-3 left-2 z-50 h-8 w-8 bg-background border border-border text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
    />
  );
}

const AppLayout = () => {
  // Marca que estamos dentro do app (sidebar presente) para ocultar o
  // toggle de tema flutuante — no app ele vive no rodapé da sidebar.
  useEffect(() => {
    document.documentElement.setAttribute("data-app", "1");
    return () => document.documentElement.removeAttribute("data-app");
  }, []);

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-foreground focus:text-sm focus:font-medium"
      >
        Pular para o conteúdo principal
      </a>
      <div className="h-screen flex w-full overflow-hidden">
        <div className="print:hidden contents">
          <AppSidebar />
        </div>
        <div className="flex-1 flex flex-col min-w-0 h-screen relative">
          <div className="print:hidden contents">
            <CollapsedOnlyTrigger />
          </div>
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
            <div className="p-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
