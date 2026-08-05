import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Filter } from "lucide-react";
import { CustomFilter, MAX_CUSTOM_FILTERS } from "@/lib/custom-filters";

interface CustomField { id: string; kommo_id: string; name: string; code: string | null; field_type?: string | null; entity_type?: string | null; }

interface CustomFiltersTabProps {
  customFields: CustomField[];
  customFilters: CustomFilter[];
  setCustomFilters: React.Dispatch<React.SetStateAction<CustomFilter[]>>;
}

export default function CustomFiltersTab({ customFields, customFilters, setCustomFilters }: CustomFiltersTabProps) {
  const leadFields = customFields.filter((f) => (f.entity_type || "").toLowerCase() === "leads");

  const addFilter = () => {
    if (customFilters.length >= MAX_CUSTOM_FILTERS) return;
    setCustomFilters((prev) => [...prev, { id: crypto.randomUUID(), label: "", fieldId: "" }]);
  };
  const removeFilter = (id: string) => setCustomFilters((prev) => prev.filter((f) => f.id !== id));
  const patchFilter = (id: string, patch: Partial<CustomFilter>) =>
    setCustomFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          Filtros Personalizados
        </CardTitle>
        <CardDescription>
          Crie dropdowns extras na barra de filtros do Dashboard, cada um baseado num campo
          personalizado de lead — ex.: um campo "Transferido" vira um filtro "Transferido"
          com os valores distintos daquele campo como opções. Até {MAX_CUSTOM_FILTERS} filtros.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {customFilters.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum filtro personalizado configurado ainda.</p>
        )}

        {customFilters.map((f) => (
          <div key={f.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-lg border p-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome do filtro</Label>
              <Input
                value={f.label}
                onChange={(e) => patchFilter(f.id, { label: e.target.value })}
                placeholder="Ex.: Transferido"
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Campo do Kommo</Label>
              <Select value={f.fieldId || "__none__"} onValueChange={(v) => patchFilter(f.id, { fieldId: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione um campo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— selecione —</SelectItem>
                  {leadFields.map((field) => (
                    <SelectItem key={field.id} value={field.code || field.kommo_id}>{field.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="icon" onClick={() => removeFilter(f.id)} aria-label="Remover filtro">
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}

        {customFilters.length < MAX_CUSTOM_FILTERS ? (
          <Button variant="outline" size="sm" onClick={addFilter}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar filtro
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Limite de {MAX_CUSTOM_FILTERS} filtros personalizados atingido.</p>
        )}
      </CardContent>
    </Card>
  );
}
