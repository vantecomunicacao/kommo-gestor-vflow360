# Plano de correção — Abas Comercial × Financeiro

## Contexto

O dashboard ganhou duas abas que compartilham a mesma tela e o mesmo campo de
período, trocando apenas o **eixo de data**:

- **Comercial** → período filtra por `kommo_created_at` (leads criados no período).
- **Financeiro** → período filtra por `closed_at` (leads fechados no período: ganho + perdido).

A troca de eixo já foi implementada (parâmetro `dateBasis`, default `criacao`), mas
uma análise de todas as funcionalidades mostrou que **trocar só o filtro não basta**:
quando o eixo é `fechamento`, o conjunto `leads` deixa de conter os leads em aberto,
e vários cards — que foram escritos assumindo "todos os leads por criação" — passam a
exibir números sem sentido (zeros, funil vazio, "Em Negociação = R$ 0").

Este plano define, **por card**, o veredito (mantém / ajusta / oculta) e as mudanças
de backend e frontend necessárias para que cada aba mostre só o que é verdadeiro nela.

## Causa raiz

`supabase/functions/kommo-dashboard/index.ts` monta um único array `leads` a partir do
filtro de período. Quase todas as métricas derivam desse array. No eixo `fechamento`:

- o array só tem leads **fechados** (ganho/perdido) → nenhum lead aberto entra;
- métricas de "pipeline aberto" (Em Negociação, Esfriando, Follow-up) zeram;
- o funil de passagem (que exclui perdidos e distribui por etapa atual) fica com tudo
  em "Venda Ganha" e ~0 no resto;
- métricas por safra (Leads por dia, agrupado por criação) ficam no eixo errado.

## Análise por funcionalidade

Legenda do veredito:
- **Comercial** = só faz sentido na aba Comercial (ocultar na Financeira).
- **Financeiro** = é o coração da aba Financeira.
- **Ambas** = válido nos dois eixos (com rótulo/eixo ajustado).

| Card / métrica | Fonte no backend | Comportamento sob `fechamento` | Veredito | Ação |
| --- | --- | --- | --- | --- |
| **Total de Leads** | `leads.length` | Vira "total de leads fechados no período" | Ambas | Rótulo/tooltip dinâmico por aba |
| **Vendas Ganhas** | bucket `venda_ganha` | = ganhos que fecharam no período (correto) | Ambas | Mantém |
| **Taxa de Conversão** | funil de passagem | Sem base de entrada → engana | Comercial | Ocultar na Financeira |
| **Receita Ganha** | `wonMonetary` | = receita que fechou no período (correto) | Ambas | Mantém (é o destaque do Financeiro) |
| **Em Negociação** | soma etapas abertas | Conjunto sem abertos → R$ 0 | Comercial | Ocultar na Financeira |
| **Ticket Médio** | receita/ganhos | Correto nos dois | Ambas | Mantém |
| **Funil de Passagem** | `funnelStages`/`conversionRates` | Só "Venda Ganha" preenchido | Comercial | Ocultar na Financeira |
| **Oportunidades Perdidas** | `lostLeads`/`lossReasons` | = perdas do período (correto) | Ambas | Mantém; destacar no Financeiro |
| **Ciclo até venda / até perda** | `cycleToWon/Lost` | criação→fechamento do subconjunto (correto) | Ambas | Mantém |
| **Origem dos leads** | `leadsOriginDistribution` | origem dos fechados (útil, mas "de entrada" é comercial) | Comercial | Ocultar na Financeira |
| **Origem das vendas** | `wonOriginDistribution` | origem do que foi ganho (correto) | Ambas | Mantém |
| **Motivos de perda** | `lossReasons` | perdas do período (correto) | Ambas | Mantém |
| **Gráficos de campos custom.** | `customFieldDistributions` | distribui sobre fechados | Comercial | Ocultar na Financeira |
| **Qualidade de dados** | `customFields` fill rate | fill rate dos fechados (pouco útil) | Comercial | Ocultar na Financeira |
| **Performance por vendedor** | `sellers` por etapa | só ganhos preenchem | Comercial | Ocultar na Financeira (v1) |
| **Leads esfriando** | `coolingLeads` (só abertos) | sempre 0 | Comercial | Ocultar na Financeira |
| **Velocidade do funil** | eventos no período | movimentação do período (processo) | Comercial | Ocultar na Financeira |
| **Follow-up / Tarefas** | tarefas dos leads no escopo | fechados não têm follow-up → ~0 | Comercial | Ocultar na Financeira |
| **Leads por dia** | `dailyLeads` (por criação) | agrupa fechados por data de criação (eixo errado) | Ambas | Backend: agrupar por `closed_at` no Financeiro; renomear "Fechamentos por dia" |
| **Tempo por etapa** | `averageTimePerStage` | calculável, mas é métrica de processo | Comercial | Ocultar na Financeira |

**Resumo da aba Financeira (o que fica):** Total de Leads (rotulado "fechados"),
Vendas Ganhas, Receita Ganha, Ticket Médio, Oportunidades Perdidas, Motivos de Perda,
Origem das Vendas, Ciclo até venda/perda, e "Fechamentos por dia".

## Mudanças — Backend (`supabase/functions/kommo-dashboard/index.ts`)

1. **`dailyLeads` sensível ao eixo** (já existe bloco em ~L445): quando
   `dateBasis === "fechamento"`, bucketizar por `closed_at` em vez de `kommo_created_at`.
   Manter janela de 7 dias terminando em `endDate`.
2. Nenhuma outra métrica muda no backend: o gating por aba é feito no frontend
   (ocultar cards), evitando ramificar toda a agregação. O backend continua devolvendo
   o payload completo; a aba escolhe o que renderizar.
3. (Já feito) filtro principal por `closed_at` quando `fechamento`, e o ramo de filtro
   adicional respeitando o eixo.

## Mudanças — Frontend (`src/pages/Dashboard.tsx`)

1. **Gating de cards por `dateBasis`.** Introduzir um flag `isFinance = dateBasis === "fechamento"`
   e renderizar condicionalmente as seções conforme a tabela acima. Cada `AnimatedSection`
   "Comercial-only" envolvida em `{!isFinance && (...)}`.
2. **KPIs (grid do topo).** Na aba Financeira, mostrar só: Total de Leads (rotulado),
   Vendas Ganhas, Receita Ganha, Ticket Médio, e um card de Perdas (usar `lostLeads`).
   Ocultar "Taxa de Conversão" e "Em Negociação".
3. **Rótulos/tooltips dinâmicos** por aba:
   - "Total de Leads": Comercial = "Leads criados no período"; Financeiro = "Leads fechados no período (ganho + perdido)".
   - Card "Leads por dia" → título "Fechamentos por dia" no Financeiro.
4. **Sem novos componentes.** Reaproveitar `MetricCard`, `LossReasons`, `OriginsCard`,
   `FunnelCycles`, `DailyLeads` como estão; apenas mostrar/ocultar e ajustar textos.

## Fora de escopo (fases seguintes)

- **Snapshot mensal ("tirar a foto")** — congelar os agregados no fim do mês para
  comparação mês a mês imutável. É o objetivo final; esta entrega (separação por eixo)
  é pré-requisito dele.
- **Respiro de ligação** entre as abas (ex.: "entrou X · fechou Y · pipeline Z").
- Reintroduzir, se desejado, uma versão *financeira* de Performance por Vendedor
  (ganhos/receita por vendedor no período de fechamento).

## Restrições (CLAUDE.md)

- Mexer **apenas** na função `kommo-dashboard` e no frontend. Nada de GHL, nada fora do
  schema `kommo`. **Nenhuma migration** (não há tabela nova; `closed_at` já existe).
- Deploy só após validação; deploy isolado da `kommo-dashboard` no projeto
  `xcrfbpyhyznyufijrdry`, com confirmação explícita.

## Verificação (end-to-end)

1. `npm run dev`; typecheck com `npx tsc -p tsconfig.app.json --noEmit`.
2. Deploy da `kommo-dashboard` (após aprovação).
3. **Aba Comercial** (regressão): números idênticos aos de hoje; todos os cards presentes.
4. **Aba Financeira**, mesmo período:
   - "Total de Leads" muda de rótulo e passa a contar fechados (ganho + perdido).
   - Some: Conversão, Em Negociação, Funil de passagem, Esfriando, Follow-up, Vendedor,
     Velocidade, Qualidade, Tempo por etapa, Origem dos leads, Gráficos custom.
   - Fica: Vendas Ganhas, Receita Ganha, Ticket, Perdas, Motivos de perda, Origem das
     vendas, Ciclos, "Fechamentos por dia".
   - Os números divergem do Comercial (um lead criado em jun e ganho em jul aparece no
     Comercial de junho e no Financeiro de julho).
5. Alternar abas mantendo o período: caches separados, sem embaralhar dados.
