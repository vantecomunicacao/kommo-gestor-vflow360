# Kommo VFlow360 Gestor

Dashboard e Análise de IA da Vante Comunicação para o CRM Kommo. Frontend Vite/React, backend em Supabase (project ref `fjncmmqvmocwykpshgsh`, schema `kommo`).

## Estrutura

- `src/` — frontend Vite/React (shadcn/ui, Tailwind, React Query)
- `supabase/functions/` — edge functions (Deno)
- `supabase/migrations/` — migrations do banco
- `Dockerfile` — build multi-stage (node:20 → nginx:alpine) servindo SPA na porta 80

## Desenvolvimento

```bash
npm install
npm run dev          # http://localhost:8080
npm run build        # produz dist/
npx tsc --noEmit     # type-check
```

## Deploy

> ⚠️ A skill antiga `/deploy-vflow360` foi **removida** deste repositório: ela
> apontava para os recursos do sistema GHL/produção e **não pode ser usada aqui**.
> Um novo fluxo de deploy, próprio deste sistema, será criado pelo responsável.

Enquanto o novo caminho de deploy não existir, o deploy deve ser feito manualmente
pelo responsável (Supabase migrations + edge functions e o frontend).
