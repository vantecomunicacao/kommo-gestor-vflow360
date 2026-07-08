import { FollowUp as FU } from "@/hooks/useKommoData";
import { ListTodo, AlarmClock, CalendarClock, UserX } from "lucide-react";
import { SectionTooltip } from "./SectionTooltip";

interface FollowUpCardProps { data?: FU; }

export function FollowUpCard({ data }: FollowUpCardProps) {
  const d = data || { tarefasAtrasadas: 0, tarefasHoje: 0, leadsSemProximaAcao: 0, porVendedor: [] };
  const tiles = [
    { label: "Tarefas atrasadas", value: d.tarefasAtrasadas, icon: AlarmClock, tone: "text-destructive" },
    { label: "Leads sem próxima ação", value: d.leadsSemProximaAcao, icon: UserX, tone: "text-warning-ink" },
    { label: "Tarefas para hoje", value: d.tarefasHoje, icon: CalendarClock, tone: "text-foreground" },
  ];

  return (
    <div className="dashboard-section animate-slide-up">
      <h2 className="section-title">
        <ListTodo className="w-5 h-5 text-primary-ink" />
        Follow-up &amp; Tarefas
        <SectionTooltip text="Higiene de vendas: tarefas vencidas, tarefas para hoje, e leads abertos sem nenhuma próxima tarefa agendada (risco de esquecimento). Respeita o período e o funil selecionados." />
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
        {tiles.map((t) => (
          <div key={t.label} className="border rounded-2xl p-4 bg-card/50">
            <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
              <t.icon className={`w-4 h-4 shrink-0 ${t.tone}`} />
              <span className="text-xs font-medium leading-tight">{t.label}</span>
            </div>
            <div className={`text-3xl font-extrabold tabular-nums ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      {d.porVendedor.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Tarefas atrasadas por vendedor</p>
          <div className="space-y-1.5">
            {d.porVendedor.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 rounded-[var(--raio-md)]">
                <span className="text-sm truncate" title={s.name}>{s.name}</span>
                <span className="text-sm font-bold text-destructive tabular-nums ml-2 shrink-0">{s.atrasadas}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
