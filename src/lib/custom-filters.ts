import { z } from "zod";

// Espelha supabase/functions/_shared/schemas.ts (CustomFilterSchema). Duplicado
// porque a edge function importa zod via URL (Deno) e o front via npm (Vite) —
// runtimes diferentes, mesmo shape. Mantenha os dois em sincronia.
export const MAX_CUSTOM_FILTERS = 4;

export const customFilterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1, "Dê um nome pro filtro").max(40),
  fieldId: z.string().min(1, "Escolha um campo"),
});
export type CustomFilter = z.infer<typeof customFilterSchema>;

export const customFiltersListSchema = z.array(customFilterSchema).max(MAX_CUSTOM_FILTERS);
