// VFlow360 Kommo — cliente HTTP compartilhado da API do Kommo (api/v4).
// Análogo ao `ghlFetch` do GHL, mas para o Kommo: Bearer token + paginação por _links.next.
// Usado pelas edge functions kommo-* (inlined, nunca edge→edge).

export interface KommoCreds {
  subdomain: string; // só o subdomínio (ex.: "vantecomunicacao")
  token: string;     // long-lived token da integração privada
}

/** Aceita "vantecomunicacao", "https://vantecomunicacao.kommo.com", etc. → "vantecomunicacao". */
export function normalizeSubdomain(raw: string): string {
  return (raw || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.kommo\.com.*$/, "")
    .replace(/\/.*$/, "");
}

export function kommoBaseUrl(subdomain: string): string {
  return `https://${normalizeSubdomain(subdomain)}.kommo.com/api/v4`;
}

// A resposta da API do Kommo não tem schema fixo (varia por endpoint) e cada
// chamador já faz `as KommoLead[]`/`as KommoPipeline[]`/etc. na borda — tipar
// aqui como algo mais estreito que `any` só empurraria o mesmo `any` pra
// dentro de um cast redundante em cada call site, sem ganho real de segurança.
/** Uma chamada à API do Kommo. Lança em !ok. Trata 204 (coleção vazia) como null. */
export async function kommoFetch(
  creds: KommoCreds,
  path: string,
  init: RequestInit = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const url = path.startsWith("http") ? path : `${kommoBaseUrl(creds.subdomain)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null; // Kommo devolve 204 para coleções vazias
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`Kommo ${res.status} on ${path}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Pagina uma coleção do Kommo seguindo _links.next.
 * `embeddedKey` é a chave dentro de _embedded (ex.: "leads", "pipelines", "users").
 */
export async function kommoFetchAll(
  creds: KommoCreds,
  path: string,
  embeddedKey: string,
  opts: { maxPages?: number; delayMs?: number } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const maxPages = opts.maxPages ?? 50;
  const delayMs = opts.delayMs ?? 180; // respeita rate limit ~7 req/s
  let url = path;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < maxPages; i++) {
    const json = await kommoFetch(creds, url);
    if (!json) break; // 204 → acabou
    const items = json?._embedded?.[embeddedKey] ?? [];
    out.push(...items);
    const next = json?._links?.next?.href;
    if (!next) break;
    url = next; // URL absoluta da próxima página
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

/** unix epoch (segundos) → ISO string, ou null. */
export function unixToIso(sec?: number | null): string | null {
  if (sec === null || sec === undefined || typeof sec !== "number") return null;
  return new Date(sec * 1000).toISOString();
}

/** Deriva o tipo do status do lead: 142 = ganho, 143 = perdido, resto = aberto. */
export function leadStatusKind(statusId: number | string | null | undefined): "won" | "lost" | "open" {
  const s = String(statusId ?? "");
  if (s === "142") return "won";
  if (s === "143") return "lost";
  return "open";
}

/** Extrai telefone/email do array custom_fields_values de um contato (codes PHONE/EMAIL). */
export function extractContactPhoneEmail(cfv: unknown[] | null | undefined): { phone: string | null; email: string | null } {
  let phone: string | null = null;
  let email: string | null = null;
  for (const raw of cfv ?? []) {
    const f = raw as { field_code?: string; values?: Array<{ value?: unknown }> } | null | undefined;
    const code = f?.field_code;
    const first = f?.values?.[0]?.value ?? null;
    if (code === "PHONE" && first && !phone) phone = String(first);
    if (code === "EMAIL" && first && !email) email = String(first);
  }
  return { phone, email };
}
