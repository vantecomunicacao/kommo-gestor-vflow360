import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DATE_TYPES } from "@/lib/dashboard-funnel";

interface CustomField { id: string; kommo_id: string; name: string; code: string | null; field_type?: string | null; entity_type?: string | null; }

interface PreferencesTabProps {
  customFields: CustomField[];
  additionalDateField: string;
  setAdditionalDateField: (v: string) => void;
}

export default function PreferencesTab({
  customFields, additionalDateField, setAdditionalDateField,
}: PreferencesTabProps) {
  const dateFields = customFields.filter((f) => (f.field_type ? DATE_TYPES.includes(f.field_type) : false));

  return (
    <>
      {/* Campo de data adicional */}
      <Card>
        <CardHeader>
          <CardTitle>Campo de data adicional (opcional)</CardTitle>
          <CardDescription>
            Quando configurado, o dashboard ganha um segundo filtro de período (somado ao período principal).
            Recomendado: <strong>Data da venda (fechamento ganho)</strong> — usa a data nativa do Kommo, sem
            precisar de campo personalizado nem preenchimento manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={additionalDateField || "__none__"}
            onValueChange={(v) => setAdditionalDateField(v === "__none__" ? "" : v)}
          >
            <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nenhum</SelectItem>
              {/* Nativos do Kommo (closed_at) — não exigem campo personalizado */}
              <SelectItem value="__closed_won__">Data da venda (fechamento ganho)</SelectItem>
              <SelectItem value="__closed_lost__">Data da perda (fechamento perdido)</SelectItem>
              {dateFields.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Campos personalizados (data)</SelectLabel>
                  {dateFields.map((f) => (
                    <SelectItem key={f.id} value={f.kommo_id}>{f.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </>
  );
}
