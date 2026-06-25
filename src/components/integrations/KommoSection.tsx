import { CheckCircle, Clock, Download, Link2, Loader2, Sparkles, Users, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FieldOption, KommoCustomField, KommoPipelineStage, KommoSync } from "./types";
import { AI_COPILOT } from "@/lib/features";

interface Props {
  connected: boolean;
  accountName: string;
  sync: KommoSync | null;
  loading: boolean;
  subdomain: string;
  token: string;
  setSubdomain: (v: string) => void;
  setToken: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onReload: () => void;
  loadingFields: boolean;
  loadingStages: boolean;
  fields: KommoCustomField[];
  stages: KommoPipelineStage[];
  toggleField: (id: string) => void;
  updateFieldDescription: (id: string, description: string) => void;
  updateOptionInstruction: (fieldId: string, optionValue: string, instruction: string) => void;
  toggleStage: (id: string) => void;
  updateStageDescription: (id: string, description: string) => void;
  aiPrompt: string;
  setAiPrompt: (v: string) => void;
  onSaveMappings: () => void;
}

const renderFieldRow = (
  field: KommoCustomField,
  toggleField: Props["toggleField"],
  updateFieldDescription: Props["updateFieldDescription"],
  updateOptionInstruction: Props["updateOptionInstruction"],
) => (
  <div
    key={field.id}
    className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
  >
    <Checkbox
      id={`field-${field.id}`}
      checked={field.selected}
      onCheckedChange={() => toggleField(field.id)}
      className="mt-1"
    />
    <div className="flex-1 space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`field-${field.id}`} className="text-sm font-medium text-foreground cursor-pointer">
          {field.name}
        </label>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {field.dataType}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground font-mono">{field.fieldKey}</p>
      {field.selected && (
        <>
          <Input
            placeholder="Descreva este campo para a IA"
            value={field.description}
            onChange={(e) => updateFieldDescription(field.id, e.target.value)}
            className="text-sm"
          />
          {field.options && field.options.length > 0 && (
            <div className="ml-2 space-y-2 border-l-2 border-primary/20 pl-3">
              <p className="text-xs font-medium text-muted-foreground">Opções ({field.options.length}):</p>
              {field.options.map((opt: FieldOption) => (
                <div key={opt.value} className="space-y-1">
                  <p className="text-xs font-medium text-foreground">{opt.value}</p>
                  <Input
                    placeholder={`Quando usar "${opt.value}"?`}
                    value={opt.instruction}
                    onChange={(e) => updateOptionInstruction(field.id, opt.value, e.target.value)}
                    className="text-xs h-7"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

export const KommoSection = ({
  connected,
  accountName,
  sync,
  loading,
  subdomain,
  token,
  setSubdomain,
  setToken,
  onConnect,
  onDisconnect,
  onReload,
  loadingFields,
  loadingStages,
  fields,
  stages,
  toggleField,
  updateFieldDescription,
  updateOptionInstruction,
  toggleStage,
  updateStageDescription,
  aiPrompt,
  setAiPrompt,
  onSaveMappings,
}: Props) => {
  const lastSyncText = sync?.last_sync_at
    ? `há ${formatDistanceToNow(new Date(sync.last_sync_at), { locale: ptBR })}`
    : "ainda não sincronizado";
  const leadsCount = typeof sync?.leads_count === "number" ? sync.leads_count : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass-card p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-info" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Kommo CRM</h3>
            <p className="text-sm text-muted-foreground">
              {connected && accountName ? `Conectado: ${accountName}` : "Integração com o Kommo"}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={connected ? "text-success border-success/30" : "text-destructive border-destructive/30"}
        >
          {connected ? (
            <>
              <CheckCircle className="w-3 h-3 mr-1" /> Conectado
            </>
          ) : (
            <>
              <XCircle className="w-3 h-3 mr-1" /> Desconectado
            </>
          )}
        </Badge>
      </div>

      {!connected ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Informe o subdomínio da sua conta Kommo e o token da integração privada (long-lived token).
          </p>
          <div className="space-y-2">
            <Label>Subdomínio</Label>
            <Input
              placeholder="suaempresa (ou suaempresa.kommo.com)"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Token (Integração privada)</Label>
            <Input
              placeholder="eyJ0eXAiOiJKV1Qi..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
            />
          </div>
          <Button onClick={onConnect} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Conectando...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 mr-1" /> Conectar
              </>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2 text-success font-medium">
              <CheckCircle className="w-4 h-4" /> Conta conectada
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4" /> Última sincronização: {lastSyncText}
            </span>
            {leadsCount !== null && (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Users className="w-4 h-4" /> {leadsCount.toLocaleString("pt-BR")} leads
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {AI_COPILOT && (
              <Button variant="outline" size="sm" onClick={onReload} disabled={loadingFields || loadingStages}>
                <Download className="w-4 h-4 mr-1" />{" "}
                {loadingFields || loadingStages ? "Carregando..." : "Recarregar dados"}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={loading} onClick={onDisconnect}>
              Desconectar
            </Button>
          </div>

          {AI_COPILOT && (
          <>
          <Separator />

          {/* Custom Fields */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-foreground text-sm">Campos do CRM</h4>
              <p className="text-xs text-muted-foreground">
                Selecione os campos que a IA deve considerar e descreva o que cada um representa
              </p>
            </div>

            {loadingFields ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando campos do CRM...
              </div>
            ) : fields.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum campo encontrado no CRM.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {fields.map((field) =>
                  renderFieldRow(field, toggleField, updateFieldDescription, updateOptionInstruction),
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Pipeline Stages */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-foreground text-sm">Etapas do Funil</h4>
              <p className="text-xs text-muted-foreground">
                Selecione as etapas que a IA deve usar e descreva quando mover o lead para cada uma
              </p>
            </div>

            {loadingStages ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando etapas do CRM...
              </div>
            ) : stages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum funil encontrado no CRM.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {stages.map((stage) => (
                  <div
                    key={stage.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      id={`stage-${stage.id}`}
                      checked={stage.selected}
                      onCheckedChange={() => toggleStage(stage.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`stage-${stage.id}`}
                          className="text-sm font-medium text-foreground cursor-pointer"
                        >
                          {stage.name}
                        </label>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {stage.pipelineName}
                        </Badge>
                      </div>
                      {stage.selected && (
                        <Input
                          placeholder="Quando mover o lead para esta etapa?"
                          value={stage.description}
                          onChange={(e) => updateStageDescription(stage.id, e.target.value)}
                          className="text-sm"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* AI Prompt */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-foreground text-sm">Prompt da IA</h4>
            </div>
            <p className="text-xs text-muted-foreground">Instruções adicionais para a IA ao analisar conversas.</p>
            <Textarea
              rows={4}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Instruções adicionais para a IA..."
              className="resize-none"
            />
          </div>

          <Button onClick={onSaveMappings}>Salvar mapeamento</Button>
          </>
          )}
        </div>
      )}
    </motion.div>
  );
};
