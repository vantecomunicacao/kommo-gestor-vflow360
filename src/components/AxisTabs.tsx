import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateBasis } from "@/lib/report-axis";

const triggerCls =
  "px-5 py-2 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md";

/** Abas Comercial (criação) x Resultados (fechamento) — usadas no Dashboard e no Relatório. */
export function AxisTabs({ value, onChange }: { value: DateBasis; onChange: (v: DateBasis) => void }) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as DateBasis)}>
      <TabsList className="h-11 gap-1 p-1.5">
        <TabsTrigger value="criacao" title="Período pela data de criação dos leads" className={triggerCls}>
          Comercial
        </TabsTrigger>
        <TabsTrigger value="fechamento" title="Período pela data de fechamento (ganho + perdido)" className={triggerCls}>
          Resultados
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
