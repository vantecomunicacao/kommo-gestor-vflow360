// Feature flags do sistema. Ligue/desligue recursos sem remover código.

/**
 * Copiloto de IA (mapeamento de campos/funil + prompt nas Integrações, e análises).
 * Recurso herdado do GoHighLevel, adiado neste sistema Kommo. Quando voltar,
 * basta mudar para `true` que a UI de mapeamento reaparece.
 */
export const AI_COPILOT = false;

/**
 * Análise de IA sob demanda do Dashboard (kommo-ai-analyze). Está no ar, porém
 * em BETA — a UI mostra um aviso não-bloqueante enquanto isto for `true`.
 * Trocar para `false` remove o aviso quando o recurso for considerado estável.
 */
export const AI_ANALYSIS_BETA = true;
