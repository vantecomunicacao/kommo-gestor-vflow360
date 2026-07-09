import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type KommoActionKind = "task" | "tag";

export interface KommoActionInput {
  workspaceId: string;
  leadKommoId: string;
  kind: KommoActionKind;
  responsibleUserId?: string | null;
  days?: number;
  text?: string;
  tag?: string;
}

/** Ações de escrita no Kommo (criar tarefa / aplicar tag) via edge function `kommo-actions`.
 *  A invalidação da lista de leads esfriando fica a cargo do chamador (para o modo em
 *  massa invalidar só uma vez ao final, evitando refetch a cada item). */
export function useKommoAction() {
  return useMutation({
    mutationFn: async (input: KommoActionInput) => {
      const { data, error } = await supabase.functions.invoke("kommo-actions", {
        body: {
          workspace_id: input.workspaceId,
          lead_kommo_id: input.leadKommoId,
          kind: input.kind,
          responsible_user_id: input.responsibleUserId ?? null,
          days: input.days ?? null,
          text: input.text ?? null,
          tag: input.tag ?? null,
        },
      });
      if (error) throw new Error(error.message);
      const errMaybe = (data as { error?: string } | null)?.error;
      if (errMaybe) throw new Error(errMaybe);
      return data as { success: boolean; kind: KommoActionKind; alreadyTagged?: boolean; alreadyDone?: boolean };
    },
  });
}
