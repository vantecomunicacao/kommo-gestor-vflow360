# Roadmap — Fase 2: Copiloto de IA no Kommo

> Estado: **planejado, não iniciado.** Criado em 2026-07-07 (ver `DECISIONS.md`).
> A Fase 1 entregou o produto de analytics Kommo. Esta fase reconstrói o **copiloto de
> IA** (a IA lê a conversa e **sugere** ações que o gestor aprova) sobre o Kommo.

## Por que não foi feito na Fase 1

O copiloto original (geração GHL) lia **mensagens de conversa** e gerava sugestões.
O schema `kommo` **não tem** conversas: sem `conversations`/`messages`/`suggestions`/
`ai_config`. Portanto o copiloto não é um "port" — é uma reconstrução que depende de
uma pergunta ainda **não respondida**.

## Pré-requisito bloqueador (fazer ANTES de qualquer código)

**Validar na documentação oficial do Kommo se dá para ler o texto das conversas via API**,
de forma confiável e retroativa. Caminhos a investigar (em ordem de probabilidade):

1. **Notes como mensagem** — mensagens de chat aparecem como `notes` no lead/contato
   (`GET /api/v4/leads/{id}/notes`, `note_type` de mensagem)? Cobre histórico?
2. **Chats API ("amojo")** — desenhada para você **ser o provedor do canal**; tende a
   dar mensagens só a partir da conexão, não histórico de canais de terceiros. Confirmar
   escopo e se serve para leitura.
3. **Talks** (`/api/v4/talks`) — entidade de conversa; verificar se expõe o conteúdo das
   mensagens ou só metadados.

**Saída dessa investigação decide tudo:**
- **Se o Kommo entrega o texto das conversas** → seguir o plano abaixo.
- **Se não entrega de forma confiável** → o copiloto por conversa **não é viável** no
  Kommo; a Fase 2 muda de natureza (ex.: sugestões baseadas só em dados estruturados do
  lead — mudança de etapa, tarefas, campos — sem leitura de conversa). Registrar a
  decisão em `DECISIONS.md` antes de investir.

## Plano (condicionado ao pré-requisito passar)

1. **Ingestão de conversa** → tabelas `kommo.conversations` / `kommo.messages` +
   função `kommo-conversations-sync` (incremental por watermark, padrão do `kommo-sync`).
2. **Menu de ações + config** → tabelas `kommo.suggestions` / `kommo.ai_config`
   (tipos fechados de sugestão + toggle/auto_approve por workspace).
3. **Cérebro** → função `kommo-analyze` (clone conceitual de `ai-analyze-v2`, camada de
   dados trocada para `kommo.messages`), disparada por cron `postgres→edge` com debounce.
   Provider/custo reusam `_shared/ai-provider.ts` + `_shared/ai-usage.ts`.
4. **Execução** → estender `kommo-manage` com `execute_suggestion` (mover etapa, nota,
   campo, valor, ganho/perdido via API Kommo). **Só após aprovação humana.**
5. **Frontend** → religar as rotas removidas na Fase 1 (`/suggestions`, `/conversations`,
   `/assistant`) e os itens de menu em `AppSidebar.tsx`; reverter os redirects de
   `landingPath`/`GestorGuard` de `/cooling-leads` para `/suggestions`.
6. **Observabilidade** → migrar `log-event` + página de Logs/Sistema para o schema
   `kommo` (hoje fora do menu).

## Princípios herdados (não violar)
- IA **só sugere**; execução **só após aprovação** do gestor (auto_approve = pré-
  autorização explícita e consciente por tipo, não um agente autônomo).
- Regra de topologia: **postgres→edge** (nunca edge→edge neste Supabase).
- Isolamento de schema: tudo em `kommo.*`; nunca tocar `public.*`/`ghl_*` (ver `../CLAUDE.md`).
