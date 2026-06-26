# CLAUDE.md

Instruções persistentes para o Claude Code neste projeto (VFlow360 / Kommo).
Leia antes de qualquer alteração.

## Regras invioláveis

### 1. NÃO alterar nada do GHL (GoHighLevel) no Supabase

É **proibido** criar, modificar, renomear, mover ou excluir qualquer recurso do
Supabase relacionado ao GHL. Isso inclui — mas não se limita a:

- **Edge functions:** `ghl-manage`, `ghl-sync`, `ghl-dashboard`,
  `ghl-conversations-sync`, `ghl-messages-sync`, `ghl-enrich-attachments`
- **Código compartilhado:** `supabase/functions/_shared/ghl-enrich.ts`,
  `supabase/functions/_shared/ghl-sync.ts`
- **Migrations / SQL:** qualquer tabela, coluna, view, função, trigger, cron ou
  policy ligada ao GHL (ex.: migrations com `ghl_` no nome)
- **Deploy / segredos / configuração** dessas funções no Supabase

Não fazer deploy, redeploy, nem rodar migrations que toquem nesses recursos.

Se uma tarefa parecer exigir mexer em algo do GHL: **pare e pergunte primeiro.**
Só prossiga com autorização explícita do usuário para aquela mudança específica.

### 2. Só enviar (push) para o GitHub oficial

O único repositório remoto autorizado é:

```text
https://github.com/vantecomunicacao/kommo-gestor-vflow360
```

- **Nunca** fazer `push` para outro remote/URL.
- **Nunca** adicionar, trocar ou criar outro remote de destino.
- Se o `origin` apontar para qualquer outro endereço: **pare e avise**, não envie.

### 3. Coolify — SÓ o projeto `Kommo-Gestor-Vflow360`

O Coolify (`http://72.60.248.166:8000`) é **compartilhado** com a produção do GHL.

- A **única** coisa que pode ser criada, alterada, deployada, reiniciada ou parada é
  o projeto **`Kommo-Gestor-Vflow360`** (e os recursos dentro dele).
- **Em hipótese alguma** alterar, deployar, reiniciar, parar ou excluir qualquer
  outro projeto/app/serviço/banco no Coolify — mesmo que o token enxergue.
  Isso inclui (mas não se limita a) o projeto/app do **GHL** (ex.: `VFlow360-Gestor-prod`).
- Operações de **leitura** (listar/inspecionar) são permitidas para identificar recursos.
- Antes de **qualquer** ação de escrita (deploy/restart/stop/update/delete), **mostrar
  o nome + UUID do recurso** que será tocado e **pedir confirmação**. Se o alvo resolver
  para um UUID/slug que **não** seja do `Kommo-Gestor-Vflow360`: **parar e avisar**, nunca
  "tentar o que parece certo".

## Onde ficam as tabelas (schemas do Supabase)

O Supabase é compartilhado, mas dividido em "andares" (schemas):

- **`kommo`** → schema **DESTE sistema** (VFlow360 Kommo). É aqui que se cria,
  altera e exclui tabelas. O app aponta para cá por padrão
  (`src/integrations/supabase/client.ts` → `db: { schema: "kommo" }`).
- **`public`** → schema do sistema **antigo / GHL**. Pode ser **lido/consultado**
  quando a tarefa exigir, mas **alterações ficam restritas**: nunca tocar em
  tabelas `ghl_*` nem em outras tabelas do `public` sem autorização explícita
  (ver Regra #1). Mudança de estrutura no `public` → **pare e pergunte**.

### Tabelas do Kommo (schema `kommo`) — inventário oficial

> **MANTER ATUALIZADO:** toda vez que uma tabela do schema `kommo` for criada,
> excluída, renomeada (ou houver mudança estrutural relevante), **atualize esta
> lista na MESMA alteração**, anotando a data e a migration responsável. Esta
> lista é a fonte de verdade — não deixe ela divergir do banco.

Criadas na migration fundacional `20260617120000_kommo_schema_foundation.sql`:

| Tabela | Função (resumo) |
| --- | --- |
| `kommo.profiles` | Perfis de usuário |
| `kommo.users` | Usuários do CRM Kommo |
| `kommo.user_roles` | Papéis/roles de usuário |
| `kommo.user_permissions` | Permissões por usuário |
| `kommo.workspaces` | Workspaces (contas) |
| `kommo.workspace_members` | Membros de cada workspace |
| `kommo.integrations` | Conexões de integração (CRM) |
| `kommo.pipelines` | Funis e etapas |
| `kommo.custom_fields` | Campos personalizados |
| `kommo.loss_reasons` | Motivos de perda |
| `kommo.contacts` | Contatos |
| `kommo.leads` | Leads / negócios |
| `kommo.sync_status` | Status de sincronização |
| `kommo.sync_watermarks` | Marcos de sincronização (incremental) |
| `kommo.dashboard_settings` | Configurações do dashboard |

Migrations posteriores que mexem no schema `kommo` **sem criar tabelas novas**:

- `20260618120000_kommo_vault_token.sql` — token da integração no Vault
- `20260618130000_kommo_sync_cron.sql` — cron de sincronização
- `20260625120000_kommo_workspace_functions.sql` — RPCs de workspace/membros no
  schema `kommo` (`create_workspace`, `can_manage_workspace`,
  `list_workspace_members`, `add_workspace_member`, `remove_workspace_member`)

#### Histórico de mudanças nas tabelas (changelog)

> Registre aqui cada criação/exclusão/alteração estrutural de tabela `kommo`,
> com data (AAAA-MM-DD) e migration. Mais recente no topo.

- 2026-06-25 (`20260625130000_kommo_dashboard_chart_fields.sql`): adicionada coluna
  `kommo.dashboard_settings.chart_custom_fields text[]` (restaura a feature nativa de
  escolher quais campos personalizados viram gráfico de pizza no dashboard).
- 2026-06-25 (`20260625120000_kommo_workspace_functions.sql`): adicionadas RPCs de
  gestão de workspace/membros no schema `kommo` (não cria/altera tabelas; apenas
  funções `SECURITY DEFINER` espelhando as de `public`, mas gravando em `kommo.*`).
