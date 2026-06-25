import { supabase } from "@/integrations/supabase/client";

/**
 * Call a Supabase edge function via the SDK (supabase.functions.invoke).
 * Used for edge functions that return the `{ success, data, error }` envelope
 * (ex.: kommo-manage). Unwraps the envelope and
 * throws on `success === false`.
 */
export async function callEdge<T = unknown>(
  fnName: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: T;
    error?: string;
  }>(fnName, { body: body ?? {} });

  if (error) throw new Error(error.message || `Failed to call ${fnName}`);
  if (!data) throw new Error(`${fnName} returned no payload`);
  if (!data.success) throw new Error(data.error || "Unknown error");
  return data.data as T;
}
