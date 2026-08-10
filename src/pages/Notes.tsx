import { useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, NotebookPen } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import NoteEditor from "@/components/notes/NoteEditor";
import { noteContentToPreview } from "@/lib/notes-text";

interface WorkspaceNote {
  id: string;
  workspace_id: string;
  title: string;
  content: JSONContent;
  reference_month: string; // yyyy-mm-dd, sempre dia 1
  created_at: string;
  updated_at: string;
}

const emptyContent: JSONContent = { type: "doc", content: [] };

function monthInputValue(dateStr: string) {
  return dateStr.slice(0, 7); // yyyy-mm
}

function monthInputToReferenceMonth(monthValue: string) {
  return `${monthValue}-01`;
}

function monthLabel(dateStr: string) {
  const d = parseISO(dateStr);
  const label = format(d, "MMMM 'de' yyyy", { locale: ptBR });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function Notes() {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [refMonth, setRefMonth] = useState(monthInputValue(new Date().toISOString()));
  const [content, setContent] = useState<JSONContent>(emptyContent);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id]);

  const loadNotes = async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("workspace_notes")
        .select("*")
        .eq("workspace_id", activeWorkspace.id)
        .order("reference_month", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      setNotes((data || []) as unknown as WorkspaceNote[]);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível carregar as anotações.");
    } finally {
      setLoading(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, WorkspaceNote[]>();
    for (const note of notes) {
      const key = note.reference_month;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(note);
    }
    return Array.from(map.entries());
  }, [notes]);

  const openNew = () => {
    setEditingId(null);
    setTitle("");
    setRefMonth(monthInputValue(new Date().toISOString()));
    setContent(emptyContent);
    setEditorOpen(true);
  };

  const openEdit = (note: WorkspaceNote) => {
    setEditingId(note.id);
    setTitle(note.title);
    setRefMonth(monthInputValue(note.reference_month));
    setContent(note.content && Object.keys(note.content).length > 0 ? note.content : emptyContent);
    setEditorOpen(true);
  };

  const save = async () => {
    if (!activeWorkspace?.id) return;
    if (!refMonth) {
      toast.error("Selecione o mês de referência.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        workspace_id: activeWorkspace.id,
        title: title.trim() || "Sem título",
        content,
        reference_month: monthInputToReferenceMonth(refMonth),
      };
      if (editingId) {
        const { error } = await supabase.from("workspace_notes").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Anotação atualizada.");
      } else {
        const { error } = await supabase
          .from("workspace_notes")
          .insert({ ...payload, created_by: user?.id ?? null });
        if (error) throw error;
        toast.success("Anotação criada.");
      }
      setEditorOpen(false);
      await loadNotes();
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível salvar a anotação.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("workspace_notes").delete().eq("id", deleteId);
      if (error) throw error;
      toast.success("Anotação excluída.");
      setDeleteId(null);
      await loadNotes();
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível excluir a anotação.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <NotebookPen className="h-6 w-6" />
            Anotações
          </h1>
          <p className="text-sm text-muted-foreground">
            Registre o que foi combinado nas reuniões mensais — pontos bons, pontos de melhoria e
            próximos passos. Não afeta métricas nem dados do cliente.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Nova anotação
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Carregando...
        </div>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma anotação ainda. Crie a primeira depois da próxima reunião.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([month, items]) => (
            <div key={month} className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {monthLabel(month)}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((note) => (
                  <Card key={note.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{note.title}</CardTitle>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(note)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(note.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <CardDescription>
                        Atualizado em {format(parseISO(note.updated_at), "dd/MM/yyyy HH:mm")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-4">
                        {noteContentToPreview(note.content) || "Sem conteúdo."}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar anotação" : "Nova anotação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="note-title">Título</Label>
                <Input
                  id="note-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Reunião mensal — pontos de melhoria"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note-month">Mês de referência</Label>
                <Input
                  id="note-month"
                  type="month"
                  value={refMonth}
                  onChange={(e) => setRefMonth(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Conteúdo</Label>
              <NoteEditor content={content} onChange={setContent} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir anotação?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
