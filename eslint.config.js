import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Funções/arquivos do GHL ou legados (não-Kommo) — protegidos pela Regra #1 do
// CLAUDE.md (proibido mexer sem autorização explícita). Excluídos do gate de
// lint bloqueante da CI: a dívida de lint deles não é do Kommo pra resolver.
const ghlAndLegacyIgnores = [
  "supabase/functions/admin-bootstrap/**",
  "supabase/functions/admin-users/**",
  "supabase/functions/ai-analyze-v2/**",
  "supabase/functions/ai-assistant/**",
  "supabase/functions/ai-insights-generate/**",
  "supabase/functions/ghl-conversations-sync/**",
  "supabase/functions/ghl-dashboard/**",
  "supabase/functions/ghl-enrich-attachments/**",
  "supabase/functions/ghl-manage/**",
  "supabase/functions/ghl-messages-sync/**",
  "supabase/functions/ghl-sync/**",
  "supabase/functions/_shared/ghl-enrich.ts",
  "supabase/functions/_shared/ghl-sync.ts",
  // Achado 2026-08-06: shared code sem "ghl" no nome, mas só consumido pelas
  // functions GHL/legado já listadas acima (ai-insights-generate/ai-assistant)
  // — ficou de fora da leva original por não bater no padrão de nome.
  "supabase/functions/_shared/dashboard-metrics.ts",
  "supabase/functions/_shared/ai-provider.ts",
  "supabase/functions/_shared/ai-usage.ts",
  // Mesmo achado no frontend: já tem @ts-nocheck próprio documentando que
  // depende do schema antigo (public/GHL) ainda não migrado — não é dívida
  // do Kommo, é decisão consciente de não migrar ainda.
  "src/components/dashboard/AIUsageCard.tsx",
];

export default tseslint.config(
  { ignores: ["dist", ...ghlAndLegacyIgnores] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // shadcn/ui gerados (padrão: exportam variants/hooks junto do componente) e
    // Provider+useX no mesmo arquivo (idioma padrão de Context do React) — o aviso
    // de fast-refresh é inerente a esses dois padrões, não dívida técnica real.
    files: ["src/components/ui/**/*.{ts,tsx}", "src/contexts/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);
