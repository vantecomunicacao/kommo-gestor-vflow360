import { useState } from "react";
import { Building2, Plus, ChevronDown, Check, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface WorkspaceSelectorProps {
  collapsed?: boolean;
}

export function WorkspaceSelector({ collapsed }: WorkspaceSelectorProps) {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, createWorkspace, loading } = useWorkspace();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createWorkspace(newName.trim());
      toast({ title: "Conta criada!", description: `"${newName.trim()}" está pronta para uso.` });
      setNewName("");
      setShowCreate(false);
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro ao criar conta", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors mx-auto">
            <Building2 className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          {loading && workspaces.length === 0 && (
            <DropdownMenuItem disabled>Carregando contas…</DropdownMenuItem>
          )}
          {workspaces.map(ws => (
            <DropdownMenuItem key={ws.id} onClick={() => setActiveWorkspaceId(ws.id)} className="flex items-center justify-between">
              <span className="truncate">{ws.name}</span>
              {ws.id === activeWorkspace?.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {isAdmin && (
            <DropdownMenuItem onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" /> Nova conta
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => navigate("/workspaces")}>
            <Settings2 className="w-4 h-4 mr-2" /> Gerenciar contas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors text-sm">
            <Building2 className="w-4 h-4 text-sidebar-primary shrink-0" />
            <span className="flex-1 text-left truncate text-sidebar-foreground font-medium">
              {activeWorkspace?.name || (loading ? "Carregando contas…" : "Selecionar conta")}
            </span>
            <ChevronDown className="w-3 h-3 text-sidebar-foreground/60 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {loading && workspaces.length === 0 && (
            <DropdownMenuItem disabled>Carregando contas…</DropdownMenuItem>
          )}
          {workspaces.map(ws => (
            <DropdownMenuItem key={ws.id} onClick={() => setActiveWorkspaceId(ws.id)} className="flex items-center justify-between">
              <span className="truncate">{ws.name}</span>
              {ws.id === activeWorkspace?.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {isAdmin && (
            <DropdownMenuItem onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" /> Nova conta
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => navigate("/workspaces")}>
            <Settings2 className="w-4 h-4 mr-2" /> Gerenciar contas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar nova conta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome da conta</Label>
              <Input
                placeholder="Ex: Empresa X, Vendedor 2..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Criando..." : "Criar conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
