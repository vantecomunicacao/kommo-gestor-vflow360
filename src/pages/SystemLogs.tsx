// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type LogRow = {
  id: string;
  level: "error" | "warning" | "info";
  source: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
  url: string | null;
  user_agent: string | null;
  env: string | null;
  workspace_id: string | null;
  user_id: string | null;
  created_at: string;
};

const PERIODS = [
  { value: "1h", label: "Última hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
];

function periodToDate(p: string): Date {
  const now = Date.now();
  const map: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - (map[p] ?? map["24h"]));
}

export default function SystemLogs() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState("24h");
  const [level, setLevel] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogRow | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    let q = supabase
      .from("system_logs")
      .select("*")
      .gte("created_at", periodToDate(period).toISOString())
      .order("created_at", { ascending: false })
      .limit(500);
    if (level !== "all") q = q.eq("level", level);
    const { data, error } = await q;
    if (error) {
      toast.error("Erro ao carregar logs");
    } else {
      setLogs((data ?? []) as LogRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, period, level]);

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const s = search.toLowerCase();
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(s) ||
        l.source.toLowerCase().includes(s) ||
        (l.stack ?? "").toLowerCase().includes(s),
    );
  }, [logs, search]);

  const counts = useMemo(() => {
    return {
      total: logs.length,
      errors: logs.filter((l) => l.level === "error").length,
      warnings: logs.filter((l) => l.level === "warning").length,
    };
  }, [logs]);

  const clearOldLogs = async () => {
    if (!confirm("Apagar todos os logs do período exibido?")) return;
    const { error } = await supabase
      .from("system_logs")
      .delete()
      .gte("created_at", periodToDate(period).toISOString());
    if (error) toast.error("Erro ao apagar logs");
    else {
      toast.success("Logs apagados");
      void fetchLogs();
    }
  };

  if (adminLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs do sistema</h1>
          <p className="text-sm text-muted-foreground">
            Erros e avisos das funções de backend e do app. Retenção automática de 30 dias.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={clearOldLogs}>
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar período
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total no período</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{counts.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Erros</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-destructive">{counts.errors}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Avisos</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-yellow-500">{counts.warnings}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por mensagem, origem ou stack..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os níveis</SelectItem>
                <SelectItem value="error">Erros</SelectItem>
                <SelectItem value="warning">Avisos</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Quando</TableHead>
                <TableHead className="w-[90px]">Nível</TableHead>
                <TableHead className="w-[200px]">Origem</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Nenhum log no período selecionado.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(log)}
                >
                  <TableCell className="text-xs whitespace-nowrap">
                    {format(new Date(log.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        log.level === "error"
                          ? "destructive"
                          : log.level === "warning"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {log.level}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{log.source}</TableCell>
                  <TableCell className="truncate max-w-[600px]">{log.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge
                variant={
                  selected?.level === "error"
                    ? "destructive"
                    : selected?.level === "warning"
                      ? "secondary"
                      : "outline"
                }
              >
                {selected?.level}
              </Badge>
              <span className="font-mono text-sm">{selected?.source}</span>
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Quando</div>
                <div>
                  {format(new Date(selected.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Mensagem</div>
                <div className="whitespace-pre-wrap break-words">{selected.message}</div>
              </div>
              {selected.stack && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Stack</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                    {selected.stack}
                  </pre>
                </div>
              )}
              {selected.url && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">URL</div>
                  <div className="break-all text-xs">{selected.url}</div>
                </div>
              )}
              {selected.context && Object.keys(selected.context).length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Contexto</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selected.context, null, 2)}
                  </pre>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                {selected.env && <div>env: {selected.env}</div>}
                {selected.workspace_id && <div>workspace: {selected.workspace_id}</div>}
                {selected.user_id && <div>user: {selected.user_id}</div>}
                {selected.user_agent && (
                  <div className="col-span-2 break-all">UA: {selected.user_agent}</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
