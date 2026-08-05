import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CoolingLeads } from "@/hooks/useKommoData";

export interface CoolingLeadsResult extends CoolingLeads {
  scope?: "seller" | "workspace";
  pipelines: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

/** Busca os leads esfriando via a edge function dedicada `cooling-leads`.
 *  O escopo (vendedor vs. workspace) é decidido no servidor; funil/vendedor são
 *  filtros de sessão (não persistidos), aplicados server-side. */
export function useCoolingLeads(workspaceId: string | null, pipelineIds: string[] = [], sellerIds: string[] = []) {
  return useQuery<CoolingLeadsResult, Error>({
    queryKey: ["cooling-leads", workspaceId, [...pipelineIds].sort().join(","), [...sellerIds].sort().join(",")],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("cooling-leads", {
        body: { workspace_id: workspaceId, pipelineIds, sellerIds },
      });
      if (error) throw new Error(error.message);
      const errMaybe = (data as { error?: string } | null)?.error;
      if (errMaybe) throw new Error(errMaybe);
      return data as CoolingLeadsResult;
    },
  });
}
