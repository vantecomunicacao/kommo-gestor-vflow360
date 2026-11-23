#!/usr/bin/env node
// Regera os dados do workspace FICTÍCIO "Clinica Modelo" (demo do Dashboard)
// com distribuições parecidas com as de uma clínica de estética/cirurgia real.
//
// Substitui os números "uniformes" dos scripts SQL antigos
// (seed-clinica-modelo.sql & cia: exatamente 57 ganhos/90 perdidos/110 abertos
// por mês, origem/vendedor/motivo sorteados com probabilidade igual, ticket
// uniforme R$5-30k). Esses scripts também usam `kommo.leads.source`, coluna
// removida em 2026-08-08 — não rodam mais.
//
// O que muda aqui:
//   - Volume diário variável (segunda cheia, domingo vazio, Black Friday),
//     crescendo de abr/2026 até HOJE (dados não param no passado).
//   - Origem desigual: Instagram Ads domina o volume mas converte pouco;
//     Indicação é pouco volume e converte muito; ~6% sem UTM.
//   - Cada lead percorre o funil de verdade (Novo -> Contato -> Agendado ->
//     [Não compareceu -> remarca] -> Proposta -> Negociação -> Ganho/Perdido),
//     com tempos entre etapas e eventos em kommo.lead_stage_events.
//   - Ticket por procedimento (botox ~R$1,9k, lipo ~R$26k...), valor só
//     aparece a partir da proposta (como no Kommo real).
//   - Vendedores com desempenho diferente; motivo de perda depende da etapa.
//   - Leads parados abertos (comum em CRM real) e tarefas no prazo/atrasadas.
//
// Uso (na raiz do repo; lê VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY do .env):
//   node scripts/seed-clinica-modelo-realista.mjs            # dry-run: só resumo
//   node scripts/seed-clinica-modelo-realista.mjs --apply    # apaga e regrava
//   SEED=7 node scripts/seed-clinica-modelo-realista.mjs     # outra amostra
//
// --apply mexe SÓ no workspace de nome exato "Clinica Modelo": apaga leads,
// contatos, eventos de etapa, tarefas, lead_actions e cache do dashboard dele,
// regrava, ajusta as Métricas Personalizadas e recalcula o Relatório
// (kommo-report-snapshot com force). Antes de apagar, salva um backup JSON
// do que existia em backups/ (pasta ignorada pelo git).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const WORKSPACE_NAME = "Clinica Modelo";
const APPLY = process.argv.includes("--apply");
const SEED = Number(process.env.SEED || 20261123);

// ---------------------------------------------------------------- env / http
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const BASE = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Accept-Profile": "kommo", "Content-Profile": "kommo", "Content-Type": "application/json" };

async function rest(method, p, body, extra = {}) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${p.split("?")[0]} -> ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const get = (p) => rest("GET", p);
async function getAll(p) {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const b = await get(`${p}&order=id&offset=${o}&limit=1000`);
    out.push(...b);
    if (b.length < 1000) return out;
  }
}
async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await rest("POST", table, rows.slice(i, i + 500), { Prefer: "return=minimal" });
  }
}

// ---------------------------------------------------------------- rng
let s = SEED >>> 0;
const rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const uni = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const wpick = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let r = rng() * tot; for (const p of pairs) { if ((r -= p[1]) <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };
const poisson = (lam) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DAY = 86400000;
const HOUR = 3600000;

// ---------------------------------------------------------------- domínio
const NOW = Date.now();
const START = Date.UTC(2026, 3, 1, 3); // 01/04/2026 00:00 (America/Sao_Paulo)
const TZ = 3 * HOUR; // BRT = UTC-3

// leads/mês no ritmo do mês inteiro (crescimento + sazonalidade leve)
const MONTH_VOLUME = { "2026-04": 470, "2026-05": 505, "2026-06": 540, "2026-07": 615, "2026-08": 570, "2026-09": 630, "2026-10": 695, "2026-11": 740 };
const DOW_WEIGHT = [0.42, 1.28, 1.17, 1.1, 1.05, 0.93, 0.6]; // dom..sáb

// share = fatia do volume; contact/sched = chance de responder/agendar; win = fecha dado que recebeu proposta
const SOURCES = [
  { name: "Instagram Ads", share: 40, contact: 0.70, sched: 0.40, win: 0.46, medium: "paid-social", surgery: 0.8,
    campaigns: [["ig_harmonizacao_facial", 30], ["ig_botox_promo", 24], ["ig_remarketing", 18], ["ig_lipo_hd", 14], ["ig_antes_depois", 14]] },
  { name: "Google Ads", share: 17, contact: 0.82, sched: 0.47, win: 0.52, medium: "paid-search", surgery: 1.9,
    campaigns: [["gads_rinoplastia_sp", 26], ["gads_lipo_sp", 28], ["gads_marca", 22], ["gads_pmax", 24]] },
  { name: "Facebook Ads", share: 10, contact: 0.64, sched: 0.35, win: 0.42, medium: "paid-social", surgery: 1.0,
    campaigns: [["fb_formulario_avaliacao", 62], ["fb_lookalike_pacientes", 38]] },
  { name: "WhatsApp", share: 10, contact: 0.93, sched: 0.52, win: 0.55, medium: "direct", surgery: 1.1, campaigns: [] },
  { name: "Indicacao", share: 8, contact: 0.96, sched: 0.72, win: 0.68, medium: "referral", surgery: 1.4,
    campaigns: [["indicacao_paciente", 82], ["parceria_dermato", 18]] },
  { name: "Site", share: 5, contact: 0.80, sched: 0.45, win: 0.50, medium: "organic", surgery: 1.3,
    campaigns: [["organico_blog", 45], ["organico_google", 55]] },
  { name: "TikTok Ads", share: 4, contact: 0.55, sched: 0.30, win: 0.38, medium: "paid-social", surgery: 0.6,
    campaigns: [["tt_antes_depois", 100]] },
  { name: null, share: 6, contact: 0.78, sched: 0.45, win: 0.50, medium: null, surgery: 1.0, campaigns: [] }, // sem UTM
];

// [nome, peso no interesse, preço min, preço max, cirurgia?]
const PROCEDURES = [
  ["Toxina Botulinica (Botox)", 18, 1390, 2390, false],
  ["Preenchimento Labial", 12, 1590, 3190, false],
  ["Harmonizacao Facial", 12, 4490, 9790, false],
  ["Bioestimulador de Colageno", 8, 2790, 5490, false],
  ["Laser / Peeling", 9, 890, 2590, false],
  ["Lipo HD", 10, 19000, 34000, true],
  ["Mamoplastia de Aumento", 10, 16000, 26000, true],
  ["Rinoplastia", 7, 15000, 24000, true],
  ["Abdominoplastia", 5, 21000, 32000, true],
  ["Blefaroplastia", 5, 8500, 13500, true],
  ["Implante Capilar", 4, 12000, 21000, true],
];

// [kommo_id, nome, fatia dos leads, multiplicador de fechamento]
const SELLERS = [["101", 32, 1.18], ["102", 28, 1.0], ["103", 24, 0.93], ["104", 16, 0.74]];

const LOSS_REASONS = [
  ["1", "Achou caro"], ["2", "Nao respondeu"], ["3", "Escolheu concorrente"], ["4", "Desistiu do procedimento"],
  ["5", "Fora da regiao"], ["6", "Contato invalido"], ["7", "So pesquisando preco"],
];
const LOSS_EARLY = [["2", 64], ["6", 13], ["7", 13], ["5", 10]];
const LOSS_NOSHOW = [["2", 55], ["4", 45]];
const LOSS_AFTER_VISIT = [["7", 45], ["4", 35], ["1", 20]];
const LOSS_PROPOSAL = [["1", 47], ["3", 22], ["4", 21], ["2", 10]];

const FEMALE = ["Maria", "Ana", "Juliana", "Fernanda", "Camila", "Larissa", "Patricia", "Aline", "Carolina", "Vanessa", "Priscila", "Renata",
  "Beatriz", "Gabriela", "Mariana", "Leticia", "Amanda", "Bruna", "Jessica", "Tatiane", "Daniela", "Simone", "Claudia", "Adriana", "Luciana",
  "Natalia", "Isabela", "Rafaela", "Bianca", "Debora", "Viviane", "Karina", "Monica", "Sandra", "Elaine", "Roberta", "Michele", "Thais",
  "Paula", "Cristiane", "Sabrina", "Helena", "Livia", "Marcela", "Raquel", "Silvia", "Lorena", "Giovanna"];
const MALE = ["Joao", "Pedro", "Lucas", "Rafael", "Bruno", "Diego", "Felipe", "Thiago", "Marcos", "Gustavo", "Andre", "Eduardo", "Rodrigo",
  "Leonardo", "Ricardo", "Fabio", "Daniel", "Carlos", "Mateus", "Vinicius"];
const LAST = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro",
  "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade",
  "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos", "Goncalves", "Santana", "Teixeira", "Araujo",
  "Moura", "Cavalcanti", "Batista", "Campos"];
const DDD = [["11", 74], ["13", 6], ["19", 7], ["12", 4], ["15", 3], ["21", 3], ["31", 3]];
const EMAIL_DOMAINS = [["gmail.com", 78], ["hotmail.com", 12], ["outlook.com", 6], ["yahoo.com.br", 4]];
const deaccent = (x) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------- geração
const iso = (ms) => new Date(ms).toISOString();
const monthKey = (ms) => new Date(ms - TZ).toISOString().slice(0, 7);
const localHour = (dayStartUtc, h) => dayStartUtc + h * HOUR; // dayStartUtc = 00:00 BRT
const businessTime = (ms) => { // empurra pra horário comercial (8h-19h BRT, seg-sáb)
  const d = new Date(ms - TZ);
  let h = d.getUTCHours() + d.getUTCMinutes() / 60;
  let day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + TZ;
  if (h > 19) { day += DAY; h = uni(8.2, 11); } else if (h < 8) h = uni(8.2, 11);
  if (new Date(day - TZ).getUTCDay() === 0) day += DAY;
  return localHour(day, h);
};

const leads = [], contacts = [], events = [], tasks = [];
let leadSeq = 24810000, contactSeq = 31540000, taskSeq = 9120000;
const contactPool = [];

function newContact(createdMs) {
  // ~7% são pacientes que já tinham contato na base (retorno/novo procedimento)
  if (contactPool.length > 50 && rng() < 0.07) return pick(contactPool);
  const female = rng() < 0.82;
  const first = pick(female ? FEMALE : MALE);
  const last = rng() < 0.55 ? `${pick(LAST)} ${pick(LAST)}` : pick(LAST);
  const name = `${first} ${last}`;
  const ddd = wpick(DDD);
  const phone = `+55 ${ddd} 9${String(Math.floor(rng() * 1e8)).padStart(8, "0")}`;
  const email = rng() < 0.58 ? `${deaccent(first)}${pick([".", "_", ""])}${deaccent(last.split(" ").pop())}${rng() < 0.5 ? Math.floor(uni(1, 99)) : ""}@${wpick(EMAIL_DOMAINS)}` : null;
  const c = { kommo_id: String(++contactSeq), name, phone, email, kommo_created_at: iso(createdMs), kommo_updated_at: iso(createdMs) };
  contacts.push(c);
  contactPool.push(c);
  return c;
}

function simulateLead(createdMs) {
  const src = wpick(SOURCES.map((x) => [x, x.share]));
  const seller = wpick(SELLERS.map((x) => [x, x[1]]));
  const proc = wpick(PROCEDURES.map((p) => [p, p[1] * (p[4] ? src.surgery : 1)]));
  const contact = newContact(createdMs);
  const id = String(++leadSeq);

  let stage = "1", t = createdMs, price = 0, lossReason = null, status = "open", closedAt = null, stale = false;
  const evs = [];
  // move pra `to` depois de `dtMs`; se cair no futuro, o lead fica parado onde está (aberto)
  const go = (to, dtMs) => {
    const t2 = t + dtMs;
    if (t2 > NOW) return false;
    evs.push({ before_status_id: stage, after_status_id: to, changed_at: iso(t2) });
    t = t2; stage = to;
    return true;
  };
  // fim do caminho: parte fica esquecida aberta no funil, o resto é marcado perdido depois de alguns dias
  const die = (pool, staleP, minD, maxD) => {
    if (rng() < staleP) { stale = true; return; }
    if (go("143", businessTime(t + uni(minD, maxD) * DAY) - t)) { status = "lost"; closedAt = t; lossReason = wpick(pool); }
  };

  (() => {
    if (rng() >= src.contact) return die(LOSS_EARLY, 0.3, 3, 21);
    if (!go("2", businessTime(t + Math.min(-Math.log(1 - rng()) * 0.45, 4) * DAY) - t)) return;
    if (rng() >= src.sched) return die(LOSS_EARLY, 0.28, 4, 25);
    if (!go("5", businessTime(t + uni(0.1, 4) * DAY) - t)) return;
    // avaliação: comparece ~72%; quem falta pode remarcar (até 2x)
    for (let attempt = 0; ; attempt++) {
      const appt = uni(2, 9) * DAY;
      if (rng() < (attempt === 0 ? 0.71 : 0.62)) {
        if (t + appt > NOW) return;
        t += appt; // compareceu
        break;
      }
      if (!go("6", businessTime(t + appt) - t)) return;
      if (attempt < 2 && rng() < 0.42) { if (!go("5", businessTime(t + uni(1, 6) * DAY) - t)) return; continue; }
      return die(LOSS_NOSHOW, 0.33, 5, 20);
    }
    if (rng() >= 0.86) return die(LOSS_AFTER_VISIT, 0.2, 2, 14);
    const listPrice = Math.round(uni(proc[2], proc[3]) / 10) * 10 - (rng() < 0.6 ? 10 : 0);
    if (!go("3", businessTime(t + uni(0, 1.2) * DAY) - t)) return;
    price = listPrice;
    const winP = clamp(src.win * seller[2] * (proc[4] ? 0.82 : 1.12), 0.08, 0.92);
    const won = rng() < winP;
    const viaNeg = rng() < (won ? 0.55 : 0.5);
    if (viaNeg && !go("4", businessTime(t + uni(1, 7) * DAY) - t)) return;
    if (won) {
      if (viaNeg && rng() < 0.45) price = Math.round(price * uni(0.88, 0.96) / 10) * 10; // desconto na negociação
      if (go("142", businessTime(t + uni(viaNeg ? 2 : 1, viaNeg ? 14 : 8) * DAY) - t)) { status = "won"; closedAt = t; }
      return;
    }
    return die(LOSS_PROPOSAL, 0.16, 4, 24);
  })();

  const lastChange = evs.length ? Date.parse(evs[evs.length - 1].changed_at) : createdMs;
  const custom = [];
  if (src.name) {
    custom.push({ field_id: "201", field_code: "UTM_SOURCE", values: [{ value: src.name }] });
    if (src.medium) custom.push({ field_id: "202", field_code: "UTM_MEDIUM", values: [{ value: src.medium }] });
    let camp = src.campaigns.length ? wpick(src.campaigns) : null;
    if (src.medium === "paid-social" && createdMs >= Date.UTC(2026, 10, 14, 3) && rng() < 0.55) camp = "black_friday_estetica";
    if (camp) custom.push({ field_id: "203", field_code: "UTM_CAMPAIGN", values: [{ value: camp }] });
  }

  // tarefas: lead aberto em andamento quase sempre tem próxima ação; parado, raramente
  let closestTask = null;
  if (status === "open") {
    const hasTask = stale ? rng() < 0.25 : rng() < 0.88;
    if (hasTask) {
      const due = businessTime((stale ? lastChange + uni(2, 10) * DAY : Math.max(lastChange, NOW - uni(0, 4) * DAY) + uni(0, 7) * DAY));
      const text = { "1": "Fazer primeiro contato", "2": "Agendar avaliacao", "5": "Confirmar avaliacao", "6": "Remarcar avaliacao",
        "3": "Follow-up do orcamento", "4": "Retornar negociacao" }[stage];
      tasks.push({ kommo_id: String(++taskSeq), lead_id: id, responsible_user_id: seller[0], task_type_id: stage === "1" || stage === "6" ? "1" : "2",
        text, complete_till: iso(due), is_completed: false, kommo_created_at: iso(lastChange), kommo_updated_at: iso(lastChange) });
      closestTask = iso(due);
    }
  }

  for (const e of evs) events.push({ event_id: crypto.randomUUID(), lead_id: id, pipeline_id: "1", ...e });
  leads.push({
    kommo_id: id, name: `${proc[0]} - ${contact.name}`, pipeline_id: "1", status_id: stage, status, price,
    responsible_user_id: seller[0], loss_reason_id: lossReason, contact_id: contact.kommo_id, contact_name: contact.name,
    contact_phone: contact.phone, contact_email: contact.email, custom_fields: custom, is_deleted: false,
    kommo_created_at: iso(createdMs), kommo_updated_at: iso(Math.min(NOW, lastChange + uni(0, 2) * HOUR)),
    closed_at: closedAt ? iso(closedAt) : null, last_status_change_at: iso(lastChange), closest_task_at: closestTask,
    _src: src.name, _proc: proc[0],
  });
}

for (let day = START; day < NOW; day += DAY) {
  const mk = monthKey(day);
  const d = new Date(day - TZ);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  let lam = (MONTH_VOLUME[mk] / dim) * DOW_WEIGHT[d.getUTCDay()] / 0.936;
  if (day >= Date.UTC(2026, 10, 14, 3)) lam *= 1.45; // campanhas de Black Friday
  lam *= uni(0.8, 1.22);
  const n = poisson(lam);
  const times = [];
  for (let i = 0; i < n; i++) {
    // pico no almoço e à noite (lead de anúncio chega fora do expediente)
    const h = wpick([[uni(0, 7), 4], [uni(7, 12), 26], [uni(12, 14), 18], [uni(14, 19), 26], [uni(19, 24), 26]]);
    const ms = localHour(day, h);
    if (ms < NOW) times.push(ms);
  }
  times.sort((a, b) => a - b).forEach(simulateLead);
}

// ---------------------------------------------------------------- resumo
const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const brl = (n) => "R$ " + Math.round(n).toLocaleString("pt-BR");
console.log(`seed=${SEED}  leads=${leads.length}  contatos=${contacts.length}  eventos=${events.length}  tarefas=${tasks.length}`);
const byMonth = {};
for (const l of leads) { const m = (byMonth[monthKey(Date.parse(l.kommo_created_at))] ||= { leads: 0, won: 0, lost: 0, open: 0 }); m.leads++; m[l.status]++; }
const revByClose = {};
for (const l of leads.filter((x) => x.status === "won")) { const m = (revByClose[monthKey(Date.parse(l.closed_at))] ||= { vendas: 0, receita: 0 }); m.vendas++; m.receita += l.price; }
console.log("\nPor mês de criação:"); console.table(byMonth);
console.log("Vendas por mês de fechamento:"); console.table(Object.fromEntries(Object.entries(revByClose).map(([k, v]) => [k, { vendas: v.vendas, receita: brl(v.receita), ticket: brl(v.receita / v.vendas) }])));
const bySrc = {};
for (const l of leads) { const k = l._src || "(sem origem)"; const m = (bySrc[k] ||= { leads: 0, won: 0 }); m.leads++; if (l.status === "won") m.won++; }
console.log("Origem:"); console.table(Object.fromEntries(Object.entries(bySrc).sort((a, b) => b[1].leads - a[1].leads).map(([k, v]) => [k, { leads: v.leads, "%": (100 * v.leads / leads.length).toFixed(1), vendas: v.won, conv: (100 * v.won / v.leads).toFixed(1) + "%" }])));
console.log("Etapa atual:", tally(leads, (l) => l.status_id));
console.log("Vendedor (vendas):", tally(leads.filter((l) => l.status === "won"), (l) => l.responsible_user_id));
console.log("Motivo de perda:", tally(leads.filter((l) => l.status === "lost"), (l) => l.loss_reason_id));
const sched = new Set(events.filter((e) => e.after_status_id === "5").map((e) => e.lead_id));
const noshow = new Set(events.filter((e) => e.after_status_id === "6").map((e) => e.lead_id));
console.log(`Agendaram: ${sched.size} (${(100 * sched.size / leads.length).toFixed(1)}% dos leads)  No-show: ${noshow.size} (${(100 * noshow.size / sched.size).toFixed(1)}% dos agendados)`);
console.log(`Tarefas atrasadas: ${tasks.filter((t) => Date.parse(t.complete_till) < NOW).length} de ${tasks.length}`);

if (!APPLY) { console.log("\nDry-run. Rode com --apply para gravar."); process.exit(0); }

// ---------------------------------------------------------------- gravação
const ws = await get(`workspaces?select=id,name&name=eq.${encodeURIComponent(WORKSPACE_NAME)}`);
if (ws.length !== 1) throw new Error(`Esperava 1 workspace "${WORKSPACE_NAME}", achei ${ws.length}`);
const wsId = ws[0].id;
const W = (t) => `${t}?workspace_id=eq.${wsId}`;

fs.mkdirSync("backups", { recursive: true });
const backupFile = path.join("backups", `clinica-modelo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const backup = {};
for (const t of ["leads", "contacts", "lead_stage_events", "tasks", "lead_actions", "loss_reasons"]) backup[t] = await getAll(`${W(t)}&select=*`);
backup.dashboard_settings = await get(`${W("dashboard_settings")}&select=*`); // 1 linha, sem coluna id
fs.writeFileSync(backupFile, JSON.stringify(backup));
console.log(`\nBackup: ${backupFile} (${Object.entries(backup).map(([k, v]) => `${k}=${v.length}`).join(", ")})`);

for (const t of ["lead_actions", "tasks", "lead_stage_events", "leads", "contacts", "dashboard_cache"]) await rest("DELETE", W(t), null, { Prefer: "return=minimal" });

await rest("POST", "loss_reasons?on_conflict=workspace_id,kommo_id",
  LOSS_REASONS.map(([kommo_id, name], i) => ({ workspace_id: wsId, kommo_id, name, sort: i + 1 })),
  { Prefer: "resolution=merge-duplicates,return=minimal" });

const withWs = (rows) => rows.map((r) => { const o = { workspace_id: wsId }; for (const [k, v] of Object.entries(r)) if (!k.startsWith("_")) o[k] = v; return o; });
await insertAll("contacts", withWs(contacts));
await insertAll("leads", withWs(leads));
await insertAll("lead_stage_events", withWs(events));
await insertAll("tasks", withWs(tasks));

// Métricas: agendamento por cascata (todo lead passa por Novo Lead);
// no-show precisa de histórico ("Nao Compareceu" fica antes de Proposta na
// ordem do funil, então a cascata contaria todo lead que chegou na proposta);
// fechamento de propostas = ganhos ÷ quem chegou em Proposta Enviada (cascata).
await rest("PATCH", W("dashboard_settings"), {
  custom_metrics: [
    { id: "taxa-fechamento-propostas", name: "Fechamento de Propostas", format: "percent", icon: "target", countMode: "cascata",
      numerator: [{ pipelineId: "1", statusId: "142" }], denominator: [{ pipelineId: "1", statusId: "3" }] },
    { id: "taxa-agendamento", name: "Taxa de Agendamento", format: "percent", icon: "calendar", countMode: "cascata",
      numerator: [{ pipelineId: "1", statusId: "5" }], denominator: [{ pipelineId: "1", statusId: "1" }] },
    { id: "taxa-no-show", name: "Taxa de No-show", format: "percent", icon: "clock", countMode: "historico",
      numerator: [{ pipelineId: "1", statusId: "6" }], denominator: [{ pipelineId: "1", statusId: "5" }] },
  ],
  updated_at: new Date().toISOString(),
}, { Prefer: "return=minimal" });
await rest("PATCH", W("sync_status"), { leads_count: leads.length, updated_at: new Date().toISOString() }, { Prefer: "return=minimal" });
console.log("Dados gravados.");

// Relatório: recalcula os meses (force ignora trava, se houver)
if (!env.INTERNAL_FUNCTION_SECRET) { console.log("INTERNAL_FUNCTION_SECRET ausente: rode 'Forçar recálculo' no Relatório."); process.exit(0); }
const r = await fetch(`${BASE}/functions/v1/kommo-report-snapshot`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-internal-secret": env.INTERNAL_FUNCTION_SECRET, apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY || KEY },
  body: JSON.stringify({ workspace_id: wsId, months: 24, force: true, forceFrom: "2024-01-01", forceTo: new Date().toISOString().slice(0, 8) + "01" }),
});
console.log(`kommo-report-snapshot -> ${r.status} ${(await r.text()).slice(0, 400)}`);
