import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoolingLeads } from "@/hooks/useKommoData";

export interface CoolingLeadsResult extends CoolingLeads {
  scope?: "seller" | "workspace";
}

/** Busca os leads esfriando via a edge function dedicada `cooling-leads`.
 *  O escopo (vendedor vs. workspace) é decidido no servidor. */
export function useCoolingLeads(workspaceId: string | null, pipelineId?: string | null) {
  return useQuery<CoolingLeadsResult, Error>({
    queryKey: ["cooling-leads", workspaceId, pipelineId ?? null],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("cooling-leads", {
        body: { workspace_id: workspaceId, pipelineId: pipelineId ?? null },
      });
      if (error) throw new Error(error.message);
      const errMaybe = (data as { error?: string } | null)?.error;
      if (errMaybe) throw new Error(errMaybe);
      return data as CoolingLeadsResult;
    },
  });
}
