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
);
