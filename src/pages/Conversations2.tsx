// @ts-nocheck — "futuramente": depende de tabelas/funcs do schema antigo (public/GHL) ainda não migradas para kommo. Página não priorizada nesta fase.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, RefreshCw, MessageSquare, Phone, Users, FileText, Download, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "sonner";

interface GhlConv {
  id: string;
  ghl_conversation_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  profile_photo_url: string | null;
  channel_type: string | null;
  last_message_at: string | null;
  last_message_body: string | null;
  last_message_direction: string | null;
  unread_count: number;
  assigned_ghl_user_id: string | null;
}

interface GhlUser {
  ghl_id: string;
  name: string;
}

interface ConvSuggestion {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

interface GhlMsg {
  id: string;
  ghl_message_id: string;
  direction: string;
  body: string | null;
  message_type: string | null;
  from_field: string | null;
  to_field: string | null;
  attachments_json: string[] | null;
  enriched_body: string | null;
  date_added: string;
}

type MediaKind = "image" | "audio" | "video" | "file";

function detectMediaKind(url: string): MediaKind {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif|bmp|svg)$/.test(clean)) return "image";
  if (/\.(mp3|ogg|oga|wav|m4a|aac|opus)$/.test(clean)) return "audio";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(clean)) return "video";
  return "file";
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "arquivo";
    return decodeURIComponent(last);
  } catch {
    return "arquivo";
  }
}

// Quando body e so um placeholder generico do Stevo/GHL e tem anexo, esconde o texto.
function isGenericMediaPlaceholder(body: string | null | undefined): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  return /^arquivo de \w+$/i.test(trimmed) || /^\[(image|audio|video|document|sticker|file)\]$/i.test(trimmed);
}

const ALL_VENDORS = "__all__";
const UNASSIGNED = "__unassigned__";
const LIST_PAGE_SIZE = 50;
const THREAD_LIMIT = 200;

const CHANNEL_LABELS: Record<string, string> = {
  TYPE_CUSTOM_SMS: "WhatsApp",
  TYPE_SMS: "SMS",
  TYPE_INSTAGRAM: "Instagram",
  TYPE_FB: "Facebook",
  TYPE_EMAIL: "Email",
  TYPE_LIVE_CHAT: "Live Chat",
  TYPE_NO_SHOW: "No-show",
  TYPE_CALL: "Ligação",
};
const channelLabel = (t: string | null | undefined) =>
  (t && CHANNEL_LABELS[t]) || t || "—";

function formatTime(dateStr: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString("pt-BR");
}

function initials(name: string | null | undefined, fallback: string) {
  const base = (name || fallback || "?").trim();
  return base.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
}

function dayLabel(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function Conversations2() {
  const { activeWorkspace } = useWorkspace();
  const [ghlUsers, setGhlUsers] = useState<GhlUser[]>([]);
  const [convs, setConvs] = useState<GhlConv[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [syncingList, setSyncingList] = useState(false);
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState<string>(ALL_VENDORS);
  const [selected, setSelected] = useState<GhlConv | null>(null);

  // Thread state
  const [messages, setMessages] = useState<GhlMsg[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadSyncing, setThreadSyncing] = useState(false);
  const [convSuggestions, setConvSuggestions] = useState<ConvSuggestion[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const threadGenRef = useRef(0); // cancela respostas obsoletas
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const listSentinelRef = useRef<HTMLDivElement | null>(null);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const toggleDescription = useCallback((msgId: string) => {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  // ============================================================
  // LISTA — paginada (50 por vez)
  // ============================================================
  const loadConvsPage = useCallback(
    async (workspaceId: string, offset: number) => {
      const { data, error } = await supabase
        .from("ghl_conversations")
        .select(
          "id, ghl_conversation_id, contact_name, contact_phone, contact_email, profile_photo_url, channel_type, last_message_at, last_message_body, last_message_direction, unread_count, assigned_ghl_user_id",
        )
        .eq("workspace_id", workspaceId)
        // Esconde conversa de EMAIL PURO (disparo de marketing, sem fala real).
        // Regra durável: esconde só se channel_type for email E nao tiver
        // mensagem real (has_messages=false, mantido por trigger). Conversa com
        // histórico real cujo último item virou email continua aparecendo.
        // (O cron pode reverter channel_type p/ email; por isso nao filtramos só
        // por canal — ver has_messages.)
        .or("channel_type.not.ilike.*email*,has_messages.is.true")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + LIST_PAGE_SIZE - 1);
      if (error) throw error;
      return (data || []) as GhlConv[];
    },
    [],
  );

  const loadInitial = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setConvs([]);
      setGhlUsers([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setHasMore(true);
    try {
      const wsId = activeWorkspace.id;
      const [convPage, userQ] = await Promise.all([
        loadConvsPage(wsId, 0),
        supabase.from("ghl_users").select("ghl_id, name").eq("workspace_id", wsId).order("name"),
      ]);
      setConvs(convPage);
      setGhlUsers((userQ.data || []) as GhlUser[]);
      setHasMore(convPage.length === LIST_PAGE_SIZE);
    } catch (e) {
      toast.error(`Erro ao carregar conversas: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, loadConvsPage]);

  useEffect(() => {
    loadInitial();
    setSelected(null);
    setMessages([]);
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!activeWorkspace?.id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = await loadConvsPage(activeWorkspace.id, convs.length);
      setConvs((prev) => [...prev, ...next]);
      if (next.length < LIST_PAGE_SIZE) setHasMore(false);
    } catch (e) {
      toast.error(`Erro ao carregar mais: ${(e as Error).message}`);
    } finally {
      setLoadingMore(false);
    }
  }, [activeWorkspace?.id, loadingMore, hasMore, convs.length, loadConvsPage]);

  // IntersectionObserver no sentinel do fim da lista
  useEffect(() => {
    const node = listSentinelRef.current;
    if (!node || !hasMore || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loading, loadMore]);

  // ============================================================
  // FILTROS UI-side
  // ============================================================
  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    ghlUsers.forEach((u) => m.set(u.ghl_id, u.name));
    return m;
  }, [ghlUsers]);

  const vendorOptions = useMemo(() => {
    const known = new Set(ghlUsers.map((u) => u.ghl_id));
    const orphan = new Set<string>();
    for (const c of convs) {
      if (c.assigned_ghl_user_id && !known.has(c.assigned_ghl_user_id)) {
        orphan.add(c.assigned_ghl_user_id);
      }
    }
    return [
      ...ghlUsers.map((u) => ({ id: u.ghl_id, label: u.name })),
      ...Array.from(orphan).map((id) => ({ id, label: `(usuário ${id.slice(0, 6)})` })),
    ];
  }, [ghlUsers, convs]);

  const matchesVendor = (c: GhlConv) => {
    if (vendor === ALL_VENDORS) return true;
    if (vendor === UNASSIGNED) return !c.assigned_ghl_user_id;
    return c.assigned_ghl_user_id === vendor;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convs.filter((c) => {
      if (!matchesVendor(c)) return false;
      if (!q) return true;
      return (
        (c.contact_name || "").toLowerCase().includes(q) ||
        (c.contact_phone || "").includes(q) ||
        (c.contact_email || "").toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, vendor, search]);

  // Se filtro removeu a conversa selecionada, desseleciona
  useEffect(() => {
    if (selected && !filtered.find((c) => c.id === selected.id)) {
      setSelected(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, search]);

  const runListSync = async () => {
    if (!activeWorkspace?.id) return;
    setSyncingList(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "ghl-conversations-sync",
        { body: { workspace_id: activeWorkspace.id } },
      );
      if (error) throw error;
      if (data?.skipped) {
        toast.info(`Sync pulado: ${data.skipped}`);
      } else {
        toast.success(
          `${data?.synced ?? 0} conversa(s) atualizadas em ${Math.round((data?.duration_ms ?? 0) / 100) / 10}s`,
        );
      }
      await loadInitial();
    } catch (e) {
      toast.error(`Erro: ${(e as Error).message}`);
    } finally {
      setSyncingList(false);
    }
  };

  // Analise manual sob demanda (mesmo papel do botao "Analisar com IA" do 1.0).
  const handleAnalyze = async () => {
    if (!selected || !activeWorkspace?.id) return;
    const wsId = activeWorkspace.id;
    const convId = selected.ghl_conversation_id;
    const convUuid = selected.id;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analyze-v2", {
        body: { workspace_id: wsId, ghl_conversation_id: convId },
      });
      if (error) throw error;
      if (data?.data?.skipped) {
        toast.info(`Análise pulada: ${data.data.reason}`);
      } else {
        const count = data?.data?.suggestions?.length || 0;
        toast[count > 0 ? "success" : "info"](
          count > 0 ? `${count} sugestão(ões) gerada(s)` : "Nenhuma sugestão relevante",
        );
      }
      await loadConvSuggestions(convUuid, threadGenRef.current);
    } catch (e) {
      toast.error(`Erro na análise: ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // ============================================================
  // THREAD — sync + load + scroll
  // ============================================================
  // Sugestoes da IA (Conversas 2.0) para a conversa selecionada.
  // ghl_conversation_id na tabela suggestions referencia ghl_conversations.id (uuid).
  const loadConvSuggestions = useCallback(async (ghlConvUuid: string, gen: number) => {
    const { data, error } = await supabase
      .from("suggestions")
      .select("id, type, title, description, status, created_at")
      .eq("ghl_conversation_id", ghlConvUuid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.warn("loadConvSuggestions falhou:", error.message);
      return;
    }
    if (threadGenRef.current !== gen) return;
    setConvSuggestions((data || []) as ConvSuggestion[]);
  }, []);

  const loadMessages = useCallback(async (workspaceId: string, ghlConversationId: string) => {
    const { data, error } = await supabase
      .from("ghl_messages")
      .select("id, ghl_message_id, direction, body, message_type, from_field, to_field, attachments_json, enriched_body, date_added")
      .eq("workspace_id", workspaceId)
      .eq("ghl_conversation_id", ghlConversationId)
      .order("date_added", { ascending: true })
      .limit(THREAD_LIMIT);
    if (error) throw error;
    return (data || []) as GhlMsg[];
  }, []);

  // Quando seleciona, dispara sync + load. Cancela refetch se trocou de conversa.
  useEffect(() => {
    if (!selected || !activeWorkspace?.id) {
      setMessages([]);
      return;
    }
    const gen = ++threadGenRef.current;
    const wsId = activeWorkspace.id;
    const convId = selected.ghl_conversation_id;

    const convUuid = selected.id;

    setThreadLoading(true);
    setMessages([]);
    setExpandedDescriptions(new Set());
    setConvSuggestions([]);

    (async () => {
      try {
        // 1) Carrega do cache local (instant)
        const local = await loadMessages(wsId, convId);
        if (threadGenRef.current !== gen) return;
        setMessages(local);
        setThreadLoading(false);

        // Sugestoes da IA ja existentes para esta conversa (2.0)
        void loadConvSuggestions(convUuid, gen);

        // 2) Sync de mensagens (backfill do historico) em background
        setThreadSyncing(true);
        const { data: syncData, error: syncErr } = await supabase.functions.invoke(
          "ghl-messages-sync",
          { body: { workspace_id: wsId, ghl_conversation_id: convId, max_messages: 100 } },
        );
        if (threadGenRef.current !== gen) return;
        if (syncErr) {
          console.warn("ghl-messages-sync falhou:", syncErr);
        } else if (typeof syncData?.synced === "number" && syncData.synced > local.length) {
          const fresh = await loadMessages(wsId, convId);
          if (threadGenRef.current !== gen) return;
          setMessages(fresh);
        }

        // 3) Enriquecimento do historico (idempotente: so processa pendentes).
        // Clique "sincronizar" = descrever/transcrever a midia antiga desta conversa.
        const { data: enrichData, error: enrichErr } = await supabase.functions.invoke(
          "ghl-enrich-attachments",
          { body: { workspace_id: wsId, ghl_conversation_id: convId, max: 100 } },
        );
        if (threadGenRef.current !== gen) return;
        if (enrichErr) {
          console.warn("ghl-enrich-attachments falhou:", enrichErr);
        } else if (typeof enrichData?.enriched === "number" && enrichData.enriched > 0) {
          const fresh = await loadMessages(wsId, convId);
          if (threadGenRef.current !== gen) return;
          setMessages(fresh);
        }
      } catch (e) {
        if (threadGenRef.current !== gen) return;
        toast.error(`Erro ao carregar mensagens: ${(e as Error).message}`);
      } finally {
        if (threadGenRef.current === gen) {
          setThreadLoading(false);
          setThreadSyncing(false);
        }
      }
    })();
  }, [selected, activeWorkspace?.id, loadMessages]);

  // Auto-scroll para o fim quando as mensagens mudam (chat-style)
  useEffect(() => {
    if (messages.length && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [messages.length, selected?.id]);

  // ============================================================
  // RENDER
  // ============================================================
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-foreground">Conversas 2.0</h1>
        <Button variant="outline" size="sm" onClick={runListSync} disabled={syncingList || !activeWorkspace}>
          {syncingList ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1" />
          )}
          Sincronizar agora
        </Button>
      </div>
      <p className="text-muted-foreground mb-6">
        Conversas do GoHighLevel — todos os canais (WhatsApp, Instagram, Facebook, etc).
      </p>

      <div className="flex gap-4 h-[calc(100%-4rem)]">
        {/* Lista esquerda */}
        <div className="w-80 shrink-0 glass-card flex flex-col">
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={vendor} onValueChange={setVendor}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Todos os vendedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VENDORS}>Todos os vendedores</SelectItem>
                <SelectItem value={UNASSIGNED}>Sem atribuição</SelectItem>
                {vendorOptions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-auto">
            {!activeWorkspace ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Selecione um workspace na barra lateral.
              </div>
            ) : convs.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma conversa sincronizada ainda.<br />
                Clique em <strong>Sincronizar agora</strong>.
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma conversa bate com o filtro.
              </div>
            ) : (
              <>
                {filtered.map((c) => {
                  const vendorName = c.assigned_ghl_user_id
                    ? userNameById.get(c.assigned_ghl_user_id)
                    : null;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`flex items-center gap-3 p-4 cursor-pointer transition-colors border-b border-border/50 ${
                        selected?.id === c.id ? "bg-muted" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                        {c.profile_photo_url ? (
                          <img
                            src={c.profile_photo_url}
                            alt={c.contact_name || ""}
                            className="w-full h-full object-cover"
                            onError={(e) => ((e.currentTarget.style.display = "none"))}
                          />
                        ) : (
                          initials(c.contact_name, c.contact_phone || "?")
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {c.contact_name || c.contact_phone || "(sem nome)"}
                          </span>
                          {vendorName && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                              {vendorName}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.last_message_body || "(sem mensagem)"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">
                          {formatTime(c.last_message_at)}
                        </span>
                        {c.unread_count > 0 && (
                          <Badge className="text-[10px] px-1.5 py-0 h-4">{c.unread_count}</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Sentinel para infinite scroll */}
                <div ref={listSentinelRef} className="py-2 flex items-center justify-center">
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : hasMore ? (
                    <span className="text-xs text-muted-foreground">role pra carregar mais</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">— fim da lista —</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Painel direito */}
        {selected ? (
          <div className="flex-1 glass-card flex flex-col">
            <div className="p-4 border-b border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                {selected.profile_photo_url ? (
                  <img
                    src={selected.profile_photo_url}
                    alt={selected.contact_name || ""}
                    className="w-full h-full object-cover"
                    onError={(e) => ((e.currentTarget.style.display = "none"))}
                  />
                ) : (
                  initials(selected.contact_name, selected.contact_phone || "?")
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">
                  {selected.contact_name || selected.contact_phone || "(sem nome)"}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.contact_phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selected.contact_phone}
                    </p>
                  )}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                    {channelLabel(selected.channel_type)}
                  </Badge>
                  {selected.assigned_ghl_user_id && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                      <Users className="w-3 h-3 mr-0.5" />
                      {userNameById.get(selected.assigned_ghl_user_id) ||
                        `(${selected.assigned_ghl_user_id.slice(0, 6)})`}
                    </Badge>
                  )}
                </div>
              </div>
              {threadSyncing && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> sincronizando...
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleAnalyze}
                disabled={analyzing || threadSyncing}
              >
                {analyzing ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analisando...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-1" /> Analisar com IA</>
                )}
              </Button>
            </div>

            {/* Sugestões da IA (Conversas 2.0) */}
            {convSuggestions.length > 0 && (
              <div className="border-b border-border bg-primary/5 px-4 py-2 space-y-1.5 max-h-40 overflow-auto">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Sparkles className="w-3.5 h-3.5" />
                  Sugestões da IA ({convSuggestions.length})
                </div>
                {convSuggestions.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 text-xs">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                      {s.type}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{s.title}</p>
                      {s.description && (
                        <p className="text-muted-foreground line-clamp-2">{s.description}</p>
                      )}
                    </div>
                    <Badge
                      variant={s.status === "approved" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                    >
                      {s.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {threadLoading && messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Nenhuma mensagem nesta conversa
                </div>
              ) : (
                messages.map((msg, i) => {
                  const msgDay = dayLabel(new Date(msg.date_added));
                  const prevDay = i > 0 ? dayLabel(new Date(messages[i - 1].date_added)) : null;
                  const showDateSeparator = i === 0 || msgDay !== prevDay;
                  const isOutbound = msg.direction === "outbound";
                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex items-center justify-center my-4">
                          <div className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full capitalize">
                            {msgDay}
                          </div>
                        </div>
                      )}
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-xl px-3 py-2 ${
                            isOutbound
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {(msg.attachments_json || []).map((url, ai) => {
                            const kind = detectMediaKind(url);
                            if (kind === "image") {
                              return (
                                <a
                                  key={ai}
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block mb-1 last:mb-0"
                                >
                                  <img
                                    src={url}
                                    alt=""
                                    loading="lazy"
                                    className="rounded-md max-h-80 w-auto"
                                  />
                                </a>
                              );
                            }
                            if (kind === "audio") {
                              return (
                                <audio
                                  key={ai}
                                  controls
                                  src={url}
                                  className="w-64 max-w-full mb-1 last:mb-0"
                                />
                              );
                            }
                            if (kind === "video") {
                              return (
                                <video
                                  key={ai}
                                  controls
                                  src={url}
                                  className="rounded-md max-h-80 w-auto mb-1 last:mb-0"
                                />
                              );
                            }
                            return (
                              <a
                                key={ai}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className={`flex items-center gap-2 px-2 py-1.5 rounded mb-1 last:mb-0 ${
                                  isOutbound
                                    ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                                    : "bg-background/60 hover:bg-background"
                                }`}
                              >
                                <FileText className="w-4 h-4 shrink-0" />
                                <span className="text-xs truncate flex-1">
                                  {fileNameFromUrl(url)}
                                </span>
                                <Download className="w-3 h-3 shrink-0 opacity-60" />
                              </a>
                            );
                          })}
                          {msg.body &&
                            !(msg.attachments_json?.length && isGenericMediaPlaceholder(msg.body)) && (
                              <p className="text-sm whitespace-pre-wrap break-words">
                                {msg.body}
                              </p>
                            )}
                          {msg.enriched_body && msg.attachments_json?.length ? (
                            (() => {
                              const expanded = expandedDescriptions.has(msg.id);
                              return (
                                <div className="mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleDescription(msg.id)}
                                    className={`flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100 transition-opacity ${
                                      isOutbound ? "text-primary-foreground" : "text-foreground"
                                    }`}
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    <span>{expanded ? "ocultar descrição IA" : "ver descrição IA"}</span>
                                    {expanded ? (
                                      <ChevronUp className="w-3 h-3" />
                                    ) : (
                                      <ChevronDown className="w-3 h-3" />
                                    )}
                                  </button>
                                  {expanded && (
                                    <div
                                      className={`mt-1.5 text-xs whitespace-pre-wrap break-words rounded-md px-2 py-1.5 ${
                                        isOutbound
                                          ? "bg-primary-foreground/10"
                                          : "bg-background/70"
                                      }`}
                                    >
                                      {msg.enriched_body}
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          ) : null}
                          <p
                            className={`text-xs mt-1 ${
                              isOutbound ? "text-primary-foreground/60" : "text-muted-foreground"
                            }`}
                          >
                            {new Date(msg.date_added).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </motion.div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <div className="flex-1 glass-card flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mx-auto mb-4" />
              <p>Selecione uma conversa para visualizar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
