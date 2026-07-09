# Plano — Tela de Relatórios (comparação mês a mês)

## Contexto

O dashboard mostra o **presente vivo** (lê o espelho atual do Kommo e reagrega a cada
filtro). Ele não serve para comparação histórica confiável, porque o passado se reescreve
quando os leads se movem. A tela de **Relatórios** resolve isso: guarda **fotos mensais
congeladas** e as apresenta numa tabela de comparação mês a mês — o substituto automático
da planilha manual. Ver [[dashboard-abas-e-proxima-fase]].

Decisões já tomadas com o usuário:
- **Tela nova** (rota própria `/relatorios`), não uma aba do dashboard. Dashboard = presente
  vivo; Relatório = passado congelado. Cada tela com um trabalho só.
- Carrega o mesmo eixo **Comercial/Financeiro** do dashboard.
- Personalização **enxuta** na v1; **tabela + gráficos moderados**.

## UX (decidido)

Layout central: **tabela métricas (linhas) × meses (colunas)** — o formato de planilha,
o jeito natural de ler evolução no tempo.

```
                    │ Abr    │ Mai    │ Jun    │ Jul*   │ Tendência
────────────────────┼────────┼────────┼────────┼────────┼──────────
Receita Ganha       │ 42.000 │ 51.000 │ 47.600 │ 38.000 │ ▁▅▄▂ ▼25%
Vendas Ganhas       │   8    │   11   │   3    │   6    │ ▃▆▁▄
Taxa de Ganho       │  22%   │  28%   │  8,8%  │  15%   │ ▄▆▁▃
Receita Perdida     │ 5.000  │ 2.000  │   0    │ 1.200  │ ▆▂▁▃
Ticket Médio        │ 5.250  │ 4.636  │15.867  │ 6.333  │ ▂▂▇▃
                    * Jul = mês parcial (ainda não fechou)
```

- **Primeira coluna fixa (sticky)** — nome da métrica nunca some ao rolar meses na horizontal.
- **Coluna "Tendência" (sparkline)** por linha — forma do período inteiro num relance.
- **Realce do melhor/pior mês** por linha (cor sutil).
- **Toggle de leitura**: Valores | Variação M/M (▲▼ %). Cor semântica respeitando o sentido
  da métrica (em Receita Perdida, cair = verde), reusando a lógica de trend do dashboard.
- **Mês parcial marcado** (asterisco/tracejado) — não comparar meio-mês com mês inteiro.
- **Data da foto** por coluna (tooltip "foto de 01/07 00:00") — confiança no dado congelado.
- **Gráfico moderado**: escolher 1–2 métricas e ver linha ao longo dos meses (abaixo da tabela).

Personalização v1 (enxuta): escolher **quais métricas** aparecem, **quantos meses**
(3/6/12), **eixo** Comercial/Financeiro, **funil**. Reordenar/agrupar/salvar visões = fase 2.

## Estratégia de dados — o ponto-chave: backfill + congelamento

Duas naturezas de métrica:

- **Reconstruíveis do espelho atual** (fatos data-carimbados que não se reescrevem):
  leads criados no mês, fechados no mês, receita ganha, receita perdida, vendas ganhas,
  win rate, ticket médio, perdas. → **Backfill imediato dos últimos N meses.**
- **Não reconstruíveis** (estado do funil no fim do mês — distribuição por etapa de leads
  abertos): só passam a existir **a partir do primeiro congelamento**.

Consequência: o relatório **já nasce com histórico real** para as métricas que mais
importam; as de "estado do funil" acumulam daqui pra frente.

## Modelo de dados (nova tabela no schema `kommo`)

`kommo.report_snapshots` (uma linha por workspace × funil × mês × eixo):

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `workspace_id` | uuid | FK workspace |
| `pipeline_id` | text | funil (ou "__all__") |
| `month` | date | 1º dia do mês (chave temporal) |
| `date_basis` | text | `criacao` \| `fechamento` |
| `metrics` | jsonb | mapa métrica→valor (flexível p/ evoluir sem migration) |
| `is_partial` | boolean | mês corrente ainda não fechado |
| `frozen_at` | timestamptz | quando a foto foi tirada |
| PK | | (`workspace_id`,`pipeline_id`,`month`,`date_basis`) |

`metrics` como jsonb evita migration a cada métrica nova. Atualizar o inventário de
tabelas no CLAUDE.md na mesma migration (regra do projeto).

## Backend

1. **Migration** `..._kommo_report_snapshots.sql` — cria a tabela + RLS (membros do
   workspace leem; escrita via service role na edge function). Sem tocar em GHL/`public`.
2. **Edge function `kommo-report-snapshot`** (nova) — calcula os agregados de um mês
   (reusando a lógica de `kommo-dashboard`) e faz **upsert** em `report_snapshots`.
   - Modo **backfill**: itera os últimos N meses e grava (para as métricas reconstruíveis).
   - Modo **mês corrente**: grava com `is_partial=true`.
   - Modo **fechar mês**: grava o mês anterior com `is_partial=false` (imutável).
   - Idempotente (upsert pela PK) → botão "refazer" seguro.
3. **Cron** `..._kommo_report_cron.sql` — dia 1º ~00:10 BRT: fecha o mês anterior
   (`is_partial=false`) e cria o corrente parcial. (Segue o padrão do `kommo_sync_cron`.)
4. **Leitura**: a tela lê `report_snapshots` direto via supabase-js (schema kommo, RLS),
   sem edge function de leitura — é só um SELECT por workspace/eixo/range.

## Frontend

- **Rota** `/relatorios` + item no menu lateral (irmão de Dashboard). Provável arquivo
  `src/pages/Reports.tsx`, seguindo o padrão de `Dashboard.tsx`.
- **Hook** `useReportSnapshots(workspaceId, dateBasis, pipelineId, months)` — SELECT em
  `report_snapshots`, ordenado por mês.
- **Componentes** novos em `src/components/reports/`: `ReportTable` (tabela sticky +
  sparkline + toggle valores/variação), `ReportChart` (linha, 1–2 métricas), `ReportToolbar`
  (eixo, range, seleção de métricas, funil, botão "Fechar mês agora").
- Reusar: toggle Comercial/Financeiro e a lógica de trend/cor do dashboard; `formatBRL`.
- Botão **"Ver histórico"** no dashboard → leva a `/relatorios` no eixo/mês atuais.

## Restrições (CLAUDE.md)

- Só schema `kommo` e frontend. Nada de GHL/`public`. Migration nova precisa atualizar o
  inventário de tabelas no CLAUDE.md na mesma alteração.
- Deploy (edge function + migration) só com **confirmação explícita**; projeto
  `xcrfbpyhyznyufijrdry`. Ver [[deploy-edge-function-kommo]].

## Fases

- **v1**: migration + tabela, edge function com backfill e fechamento, cron, tela
  `/relatorios` com tabela (sticky + sparkline + toggle valores/variação), gráfico de linha
  moderado, personalização enxuta (métricas/range/eixo/funil), mês parcial e data-da-foto.
- **v2**: reordenar/agrupar métricas, salvar visões/presets, export (CSV/PDF), variação A/A.

## Verificação

1. Rodar a migration local; conferir tabela criada e RLS.
2. Backfill: invocar `kommo-report-snapshot` (backfill N meses) e comparar 1–2 meses contra
   o `kommo-dashboard` do mesmo período/eixo (devem bater).
3. Fechar mês: rodar o modo "fechar" e conferir `is_partial=false` + `frozen_at`.
4. Tela: abrir `/relatorios`, alternar eixo, mudar range, conferir sparklines/variação e o
   mês parcial marcado.
5. Idempotência: rodar o snapshot 2x e confirmar que não duplica (upsert pela PK).
