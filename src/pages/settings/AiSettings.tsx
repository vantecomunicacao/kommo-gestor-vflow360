import { Brain, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AiSettings = () => {
  const { user } = useAuth();
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingAi, setSavingAi] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchConfig = async () => {
      const { data } = await supabase
        .from("ai_provider_config" as any)
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        const d = data as any;
        setOpenaiApiKey(d.api_key || "");
        setOpenaiModel(d.model || "gpt-4o");
      }
    };
    fetchConfig();
  }, [user]);

  const saveAiProvider = async () => {
    if (!user) return;
    setSavingAi(true);
    try {
      if (!openaiApiKey.trim()) {
        toast.error("Informe a chave da API da OpenAI");
        setSavingAi(false);
        return;
      }

      const payload = {
        user_id: user.id,
        provider: "openai",
        api_key: openaiApiKey.trim(),
        model: openaiModel,
      };

      const { data: existing } = await supabase
        .from("ai_provider_config" as any)
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        await (supabase.from("ai_provider_config" as any) as any)
          .update(payload)
          .eq("user_id", user.id);
      } else {
        await supabase.from("ai_provider_config" as any).insert(payload as any);
      }

      toast.success("Configuração de IA salva com sucesso!");
    } catch (e) {
      toast.error("Erro ao salvar configuração de IA");
    } finally {
      setSavingAi(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Provedor de IA</h1>
        <p className="text-muted-foreground">Modelo usado nas análises e sugestões</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-primary" /> Provedor de IA
        </h3>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Cada conta usa sua própria chave da OpenAI, para que o custo de IA seja
            atribuído individualmente. Configure abaixo a chave desta conta.
          </p>

          <div className="space-y-2">
            <Label>Chave da API (OpenAI)</Label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder="sk-..."
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Obtenha em{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="text-primary underline">
                platform.openai.com/api-keys
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label>Modelo</Label>
            <Select value={openaiModel} onValueChange={setOpenaiModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={saveAiProvider} disabled={savingAi}>
            {savingAi ? "Salvando..." : "Salvar configuração de IA"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default AiSettings;
