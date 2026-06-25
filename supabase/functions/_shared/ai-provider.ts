// Resolucao do provider/modelo/chave de IA por workspace.
//
// Provider config do owner do workspace; sem fallback de token global do sistema.
// Regra do projeto: trabalho comum vive em _shared/ e e INLINED (import direto),
// nunca chamado via HTTP edge->edge.
//
// Hoje so ha um provider real (OpenAI). A funcao mantem a forma generica para
// quando houver outro, mas sempre resolve para o endpoint/label da OpenAI.

export interface AiProviderConfigRow {
  provider?: string;
  api_key?: string;
  model?: string;
}

export interface ResolvedAiProvider {
  useOpenAI: boolean;
  model: string;
  providerLabel: string;
  apiKey: string;
  endpoint: string;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

// Le ai_provider_config do owner do workspace e resolve a chave/modelo a usar.
// Cada conta DEVE ter sua propria chave (sem fallback de token global do sistema),
// para que o custo de IA seja atribuido a cada conta. Lanca se a conta nao tiver chave.
export async function resolveAiProvider(
  supabase: any,
  ownerUserId: string,
): Promise<ResolvedAiProvider> {
  const { data: providerConfig } = await supabase
    .from("ai_provider_config")
    .select("provider, api_key, model")
    .eq("user_id", ownerUserId)
    .maybeSingle();

  const cfg = (providerConfig || null) as AiProviderConfigRow | null;
  const hasKey = cfg?.provider === "openai" && !!cfg?.api_key;

  if (!hasKey) {
    throw new Error(
      "Nenhuma chave de IA configurada para esta conta. Configure sua chave de OpenAI em Configurações › IA.",
    );
  }

  return {
    useOpenAI: true,
    model: cfg!.model || DEFAULT_MODEL,
    providerLabel: "openai",
    apiKey: cfg!.api_key!,
    endpoint: OPENAI_ENDPOINT,
  };
}

// String de versao do provider gravada junto com a saida (ex: "openai/gpt-4o-mini").
export function aiProviderString(resolved: ResolvedAiProvider): string {
  return `${resolved.providerLabel}/${resolved.model}`;
}
