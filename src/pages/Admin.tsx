import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Trash2, KeyRound, Shield, ShieldOff, UserPlus, Loader2, Lock } from "lucide-react";

interface UserPerms {
  view_cooling: boolean;
  view_dashboard: boolean;
  view_integrations: boolean;
  view_settings: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  roles: string[];
  workspaces: { workspace_id: string; role: string; name: string }[];
  permissions: UserPerms;
}

interface Workspace { id: string; name: string; owner_id: string; }

export default function Admin() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  // create-user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newWorkspace, setNewWorkspace] = useState<string>("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newPerms, setNewPerms] = useState<UserPerms>({
    view_cooling: false,
    view_dashboard: false,
    view_integrations: false,
    view_settings: false,
  });
  const [creating, setCreating] = useState(false);

  // password dialog
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [newPw, setNewPw] = useState("");

  // workspace assignment dialog
  const [wsUser, setWsUser] = useState<AdminUser | null>(null);
  const [wsToAdd, setWsToAdd] = useState<string>("");

  // permissions dialog
  const [permsUser, setPermsUser] = useState<AdminUser | null>(null);
  const [permsDraft, setPermsDraft] = useState<UserPerms>({
    view_cooling: false,
    view_dashboard: false,
    view_integrations: false,
    view_settings: false,
  });

  const callAdmin = async <T = Record<string, unknown>>(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> => {
    const { data, error } = await supabase.functions.invoke<T & { error?: string }>(
      "kommo-admin-users",
      { body: { action, ...payload } },
    );
    if (error) {
      // Em erros 4xx/5xx o supabase-js só expõe uma mensagem genérica
      // ("non-2xx status code") e deixa o motivo real no corpo da resposta
      // (error.context). Tentamos ler o `error` que a edge function devolve.
      let detail = "";
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.clone().json();
          detail = body?.error || "";
        } catch (_) { /* corpo não é JSON */ }
      }
      throw new Error(detail || error.message);
    }
    if (data && (data as { error?: string }).error) throw new Error((data as { error?: string }).error!);
    return data as T;
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [u, w] = await Promise.all([
        callAdmin<{ users?: AdminUser[] }>("list_users"),
        callAdmin<{ workspaces?: Workspace[] }>("list_workspaces"),
      ]);
      setUsers(u.users || []);
      setWorkspaces(w.workspaces || []);
    } catch (e) {
      toast.error("Erro ao carregar usuários", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roleLoading && isAdmin) refresh();
    // `refresh` é recriada a cada render (não usa useCallback) — incluí-la aqui
    // faria o efeito rodar em todo render, não só quando role/isAdmin mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isAdmin]);

  const promoteSelf = async () => {
    setBootstrapping(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        error?: string;
        promoted?: boolean;
      }>("kommo-admin-bootstrap");
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.promoted) {
        toast.success("Você é o admin master agora! Recarregando...");
        setTimeout(() => window.location.reload(), 800);
      } else {
        toast.error("Já existe outro admin no sistema");
      }
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    } finally {
      setBootstrapping(false);
    }
  };

  const handleCreate = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Email e senha são obrigatórios");
      return;
    }
    setCreating(true);
    try {
      await callAdmin("create_user", {
        email: newEmail,
        password: newPassword,
        full_name: newName || null,
        workspace_id: newWorkspace || null,
        role: newRole,
        permissions: newPerms,
      });
      toast.success("Usuário criado");
      setCreateOpen(false);
      setNewEmail(""); setNewPassword(""); setNewName(""); setNewWorkspace(""); setNewRole("user");
      setNewPerms({ view_cooling: false, view_dashboard: false, view_integrations: false, view_settings: false });
      refresh();
    } catch (e) {
      toast.error("Erro ao criar", { description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const openPermsDialog = (u: AdminUser) => {
    setPermsUser(u);
    setPermsDraft({ ...u.permissions });
  };

  const savePermissions = async () => {
    if (!permsUser) return;
    try {
      await callAdmin("set_permissions", { user_id: permsUser.id, permissions: permsDraft });
      toast.success("Permissões atualizadas");
      setPermsUser(null);
      refresh();
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  const handlePasswordChange = async () => {
    if (!pwUser || !newPw) return;
    try {
      await callAdmin("update_password", { user_id: pwUser.id, password: newPw });
      toast.success("Senha alterada");
      setPwUser(null);
      setNewPw("");
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  const handleDelete = async (u: AdminUser) => {
    try {
      await callAdmin("delete_user", { user_id: u.id });
      toast.success("Usuário removido");
      refresh();
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  const toggleAdminRole = async (u: AdminUser) => {
    const isUserAdmin = u.roles.includes("admin");
    try {
      await callAdmin("set_role", { user_id: u.id, role: "admin", enabled: !isUserAdmin });
      toast.success(isUserAdmin ? "Admin removido" : "Promovido a admin");
      refresh();
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  const addToWorkspace = async () => {
    if (!wsUser || !wsToAdd) return;
    try {
      await callAdmin("add_to_workspace", { user_id: wsUser.id, workspace_id: wsToAdd });
      toast.success("Adicionado à conta");
      setWsToAdd("");
      refresh();
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  const removeFromWorkspace = async (u: AdminUser, ws_id: string) => {
    try {
      await callAdmin("remove_from_workspace", { user_id: u.id, workspace_id: ws_id });
      toast.success("Removido da conta");
      refresh();
    } catch (e) {
      toast.error("Erro", { description: (e as Error).message });
    }
  };

  if (roleLoading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-xl space-y-4">
        <Card>
          <CardHeader><CardTitle>Acesso restrito</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta página é apenas para administradores. Se ainda não há nenhum admin no sistema,
              você pode se promover ao primeiro admin master.
            </p>
            <Button onClick={promoteSelf} disabled={bootstrapping}>
              {bootstrapping ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
              Tornar-me admin master
            </Button>
            <p className="text-xs text-muted-foreground">
              Logado como: <span className="font-mono">{user?.email}</span>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Administração</h1>
          <p className="text-muted-foreground text-sm">Gerencie usuários, contas e permissões</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="w-4 h-4 mr-2" />Novo usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar novo usuário</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
              <div><Label>Email *</Label><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
              <div><Label>Senha *</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
              <div>
                <Label>Atribuir à conta (opcional)</Label>
                <Select value={newWorkspace} onValueChange={setNewWorkspace}>
                  <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                  <SelectContent>
                    {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label>Promover a admin</Label>
                <Switch checked={newRole === "admin"} onCheckedChange={(v) => setNewRole(v ? "admin" : "user")} />
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-sm font-semibold">Permissões de acesso</Label>
                <p className="text-xs text-muted-foreground">
                  Marque as áreas que este usuário poderá acessar.
                </p>
                <div className="flex items-center justify-between pt-1">
                  <Label className="font-normal">Ver Dashboard e Relatórios</Label>
                  <Switch
                    checked={newPerms.view_dashboard}
                    onCheckedChange={(v) => setNewPerms((p) => ({ ...p, view_dashboard: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">Ver Leads esfriando</Label>
                  <Switch
                    checked={newPerms.view_cooling}
                    onCheckedChange={(v) => setNewPerms((p) => ({ ...p, view_cooling: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">Ver Integrações</Label>
                  <Switch
                    checked={newPerms.view_integrations}
                    onCheckedChange={(v) => setNewPerms((p) => ({ ...p, view_integrations: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">Ver Configurações</Label>
                  <Switch
                    checked={newPerms.view_settings}
                    onCheckedChange={(v) => setNewPerms((p) => ({ ...p, view_settings: v }))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <Card>
          <CardHeader><CardTitle>Usuários ({users.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 border border-border rounded-lg">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{u.full_name || u.email}</span>
                    {u.roles.includes("admin") && <Badge variant="default" className="bg-primary">Admin</Badge>}
                    {u.id === user?.id && <Badge variant="outline">Você</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {u.workspaces.map((w) => (
                      <Badge key={w.workspace_id} variant="secondary" className="gap-1">
                        {w.name}
                        <button onClick={() => removeFromWorkspace(u, w.workspace_id)} className="hover:text-destructive">×</button>
                      </Badge>
                    ))}
                    {u.workspaces.length === 0 && <span className="text-xs text-muted-foreground">Sem contas</span>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setWsUser(u)}>
                    <Plus className="w-3 h-3 mr-1" />Conta
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openPermsDialog(u)} disabled={u.roles.includes("admin")}>
                    <Lock className="w-3 h-3 mr-1" />Permissões
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleAdminRole(u)} disabled={u.id === user?.id}>
                    {u.roles.includes("admin") ? <ShieldOff className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPwUser(u)}>
                    <KeyRound className="w-3 h-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" disabled={u.id === user?.id}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Remove permanentemente {u.email}. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(u)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Password dialog */}
      <Dialog open={!!pwUser} onOpenChange={(o) => !o && setPwUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Alterar senha — {pwUser?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Nova senha</Label>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwUser(null)}>Cancelar</Button>
            <Button onClick={handlePasswordChange}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to workspace dialog */}
      <Dialog open={!!wsUser} onOpenChange={(o) => !o && setWsUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar {wsUser?.email} a uma conta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Conta</Label>
            <Select value={wsToAdd} onValueChange={setWsToAdd}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {workspaces
                  .filter((w) => !wsUser?.workspaces.some((uw) => uw.workspace_id === w.id))
                  .map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWsUser(null)}>Cancelar</Button>
            <Button onClick={addToWorkspace} disabled={!wsToAdd}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions dialog */}
      <Dialog open={!!permsUser} onOpenChange={(o) => !o && setPermsUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permissões — {permsUser?.full_name || permsUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Ative apenas as áreas que este usuário poderá acessar.
            </p>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Ver Dashboard e Relatórios</Label>
              <Switch
                checked={permsDraft.view_dashboard}
                onCheckedChange={(v) => setPermsDraft((p) => ({ ...p, view_dashboard: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Ver Leads esfriando</Label>
              <Switch
                checked={permsDraft.view_cooling}
                onCheckedChange={(v) => setPermsDraft((p) => ({ ...p, view_cooling: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Ver Integrações</Label>
              <Switch
                checked={permsDraft.view_integrations}
                onCheckedChange={(v) => setPermsDraft((p) => ({ ...p, view_integrations: v }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-normal">Ver Configurações</Label>
              <Switch
                checked={permsDraft.view_settings}
                onCheckedChange={(v) => setPermsDraft((p) => ({ ...p, view_settings: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermsUser(null)}>Cancelar</Button>
            <Button onClick={savePermissions}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
