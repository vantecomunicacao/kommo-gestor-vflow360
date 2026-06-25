import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

const STORAGE_KEY = "vflow-theme";
const EVENT = "vflow-theme-change";

function isDarkNow(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/**
 * Estado de tema compartilhado entre instâncias via evento custom + storage.
 * Fonte da verdade: a classe `dark` no <html> (aplicada cedo pelo script inline).
 */
function useThemeMode() {
  const [isDark, setIsDark] = useState<boolean>(isDarkNow);

  useEffect(() => {
    const sync = () => setIsDark(isDarkNow());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => {
    const next = !isDarkNow();
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    window.dispatchEvent(new Event(EVENT));
  };

  return { isDark, toggle };
}

interface ThemeToggleProps {
  /** "floating": botão fixo no canto inferior esquerdo (oculto dentro do app).
   *  "inline": para uso dentro da sidebar. */
  placement?: "floating" | "inline";
  className?: string;
}

/** Botão discreto para alternar tema claro/escuro. */
export function ThemeToggle({ placement = "floating", className }: ThemeToggleProps) {
  const { isDark, toggle } = useThemeMode();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      className={cn(
        "flex items-center justify-center rounded-full text-muted-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        placement === "floating" &&
          "fixed bottom-4 left-4 z-[60] h-9 w-9 border border-border/60 bg-background/70 opacity-50 shadow-sm backdrop-blur-sm hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:ring-offset-2 focus-visible:ring-offset-background [html[data-app]_&]:hidden [html[data-auth-light]_&]:hidden",
        placement === "inline" &&
          "h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        className,
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
