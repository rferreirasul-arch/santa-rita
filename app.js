"use strict";

const CFG = window.APP_CONFIG || {};
const DEMO = !CFG.API_URL || !CFG.CLIENT_ID;
const PERDAS = ["Natimorto", "Morreu após o parto", "Aborto"];
const VIVOS = ["Vivo", "Enxertado"];
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let registros = [];   // todos os registros guardados no aparelho (inclusive excluídos)
let reproducao = [];  // inseminações vindas da aba "Reproducao" da planilha
let usuario = null;   // { email, nome, token, exp }
let editId = null;
let sincronizando = false;
let limiteLista = 60;

// =====================================================================
// Banco local (IndexedDB): é aqui que os registros ficam quando não há sinal
// =====================================================================
const db = (() => {
  let conexao;
  const abrir = () => conexao ||= new Promise((ok, falha) => {
    const r = indexedDB.open("fazenda-santa-rita", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("registros", { keyPath: "id" });
      r.result.createObjectStore("meta");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
  const tx = async (loja, modo, fn) => {
    const d = await abrir();
    return new Promise((ok, falha) => {
      const t = d.transaction(loja, modo);
      const req = fn(t.objectStore(loja));
      t.oncomplete = () => ok(req?.result);
      t.onerror = () => falha(t.error);
    });
  };
  return {
    todos: () => tx("registros", "readonly", (s) => s.getAll()),
    gravar: (r) => tx("registros", "readwrite", (s) => s.put(r)),
    gravarVarios: (rs) => tx("registros", "readwrite", (s) => { rs.forEach((r) => s.put(r)); }),
    apagar: (ids) => tx("registros", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); }),
    ler: (k) => tx("meta", "readonly", (s) => s.get(k)),
    salvar: (k, v) => tx("meta", "readwrite", (s) => s.put(v, k)),
  };
})();

// =====================================================================
// Utilidades
// =====================================================================
const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const normId = (v) => String(v ?? "").trim().toUpperCase().replace(/^0+(?=\w)/, "");
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const fmtNum = (n, casas = 0) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ehPerda = (r) => PERDAS.includes(r.situacao);
const ehVivo = (r) => VIVOS.includes(r.situacao);
const ativos = () => registros.filter((r) => !r.excluido);
const pendentes = () => registros.filter((r) => r._pendente);

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), ms);
}

// =====================================================================
// Login com conta Google
// =====================================================================
const tokenValido = () => usuario?.token && usuario.exp - Date.now() > 60_000;
let esperandoToken = [];

function lerJwt(token) {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

async function aoReceberCredencial(resp) {
  const info = lerJwt(resp.credential);
  const primeiroAcesso = !usuario;
  usuario = {
    email: info.email.toLowerCase(),
    nome: info.given_name || info.name || info.email,
    token: resp.credential,
    exp: info.exp * 1000,
  };
  esperandoToken.splice(0).forEach((fim) => fim(usuario.token));
  $("#relogin").hidden = true;

  if (!primeiroAcesso) {
    localStorage.setItem("fsr_usuario", JSON.stringify(usuario));
    return;
  }
  // Primeiro acesso: confere na planilha se o e-mail está autorizado antes de entrar
  $("#login-msg").textContent = "Verificando autorização…";
  try {
    await chamarApi({ action: "ping", token: usuario.token });
    localStorage.setItem("fsr_usuario", JSON.stringify(usuario));
    $("#login-msg").textContent = "";
    entrarNoApp();
    sincronizar();
  } catch (e) {
    $("#login-msg").textContent = e.message;
    usuario = null;
    google.accounts.id.disableAutoSelect();
  }
}

window.onGoogleLibraryLoad = () => {
  if (DEMO) return;
  google.accounts.id.initialize({
    client_id: CFG.CLIENT_ID,
    callback: aoReceberCredencial,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
  });
  const opcoes = { theme: "filled_blue", size: "large", text: "signin_with", shape: "pill", locale: "pt-BR" };
  google.accounts.id.renderButton($("#gbtn"), opcoes);
  google.accounts.id.renderButton($("#relogin-btn"), { ...opcoes, size: "medium" });
  if (!usuario) google.accounts.id.prompt();
};

function obterToken() {
  if (tokenValido()) return Promise.resolve(usuario.token);
  if (!window.google?.accounts?.id) return Promise.resolve(null);
  return new Promise((ok) => {
    let feito = false;
    const fim = (t) => { if (!feito) { feito = true; ok(t); } };
    esperandoToken.push(fim);
    google.accounts.id.prompt();
    // Se o Google não renovar sozinho, pede para a pessoa clicar em "Entrar"
    setTimeout(() => {
      if (!tokenValido()) { $("#relogin").hidden = false; fim(null); }
    }, 8000);
  });
}

function sair() {
  const n = pendentes().length;
  if (n && !confirm(`Há ${n} registro(s) ainda não enviados à planilha. Se sair agora, eles continuam guardados neste aparelho e serão enviados no próximo login. Sair mesmo assim?`)) return;
  localStorage.removeItem("fsr_usuario");
  window.google?.accounts?.id?.disableAutoSelect();
  location.reload();
}

// =====================================================================
// Sincronização com a planilha (Google Apps Script)
// =====================================================================
async function chamarApi(corpo) {
  const r = await fetch(CFG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita a checagem CORS extra
    body: JSON.stringify(corpo),
  });
  const j = await r.json();
  if (!j.ok) {
    const erro = new Error(j.erro || "Erro no servidor");
    erro.codigo = j.codigo;
    throw erro;
  }
  return j;
}

const semCampoLocal = ({ _pendente, ...r }) => r;

async function sincronizar(manual = false) {
  if (sincronizando) return;
  if (DEMO) { if (manual) toast("Modo demonstração: configure o config.js para ligar a planilha."); return; }
  if (!navigator.onLine) { if (manual) toast("Sem sinal. Os registros estão guardados neste aparelho."); atualizarStatus(); return; }

  sincronizando = true;
  atualizarStatus();
  try {
    const token = await obterToken();
    if (!token) { if (manual) toast("Entre com sua conta Google para sincronizar."); return; }

    const envio = pendentes().map(semCampoLocal);
    const resp = await chamarApi({ action: "sync", token, registros: envio });

    // Junta o que veio da planilha com o que está no aparelho.
    // Um registro editado aqui durante o envio (mais novo) continua pendente.
    const locais = new Map((await db.todos()).map((r) => [r.id, r]));
    const doServidor = new Set();
    const gravar = [];
    for (const s of resp.registros) {
      doServidor.add(s.id);
      const l = locais.get(s.id);
      if (l?._pendente && l.atualizado_em > s.atualizado_em) continue;
      gravar.push({ ...s, _pendente: false });
    }
    const remover = [...locais.values()].filter((l) => !doServidor.has(l.id) && !l._pendente).map((l) => l.id);
    await db.gravarVarios(gravar);
    await db.apagar(remover);

    reproducao = resp.reproducao || [];
    await db.salvar("reproducao", reproducao);
    await db.salvar("ultimo_sync", Date.now());
    registros = await db.todos();
    renderTudo();
    if (manual || envio.length) toast(envio.length ? `${envio.length} registro(s) enviado(s) à planilha.` : "Tudo sincronizado.");
  } catch (e) {
    if (e.codigo === "AUTH") { usuario.exp = 0; $("#relogin").hidden = false; }
    else if (e.codigo === "NEGADO") toast(e.message, 6000);
    else if (manual) toast("Não foi possível sincronizar agora. Tentaremos de novo automaticamente.");
    console.warn("Sincronização:", e);
  } finally {
    sincronizando = false;
    atualizarStatus();
  }
}

async function atualizarStatus() {
  const el = $("#sync-status");
  const n = pendentes().length;
  el.className = "pill";
  if (DEMO) { el.textContent = "Demonstração"; return; }
  if (sincronizando) { el.textContent = "Sincronizando…"; return; }
  if (!navigator.onLine) {
    el.classList.add("off");
    el.textContent = n ? `Sem sinal · ${n} pendente${n > 1 ? "s" : ""}` : "Sem sinal";
    return;
  }
  if (n) { el.classList.add("pend"); el.textContent = `${n} pendente${n > 1 ? "s" : ""}`; return; }
  el.classList.add("ok");
  el.textContent = "Sincronizado";
}

// =====================================================================
// Formulário de registro
// =====================================================================
const form = () => $("#form");
const campo = (nome) => form().elements[nome];
// Botões de escolha (sexo, gêmeos): o valor fica guardado no próprio grupo
const valorSeg = (id) => $(`#${id}`).dataset.valor || $(`#${id} .on`)?.dataset.v || "";
function marcarSeg(id, v) {
  $(`#${id}`).dataset.valor = v;
  $$(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  if (id === "seg-gemeo") $("#bloco-gemeo").hidden = !(v === "Sim" && !gemeoJaSalvo());
}
// Ao editar um terneiro que já é gêmeo, o 2º já existe como outro registro
const gemeoJaSalvo = () => editId && registros.find((r) => r.id === editId)?.gemeo === "Sim";

// Regra do pai, a partir da aba Reproducao (uma linha por vaca):
// toque IATF prenha → touro da IATF; nos demais casos → touro da última IA
// (repasse, IATF vazia sem outra IA ou sem toque registrado).
function sugestaoReproducao(mae, dataNasc) {
  const m = normId(mae);
  if (!m || !dataNasc) return null;
  const r = reproducao.find((x) => normId(x.mae) === m);
  if (!r) return null;
  const iatf = r.data_iatf ?? r.data_ia ?? "";
  const touroIatf = r.touro_iatf ?? r.touro ?? "";
  const ult = r.data_ult || iatf;
  const touroUlt = r.touro_ult || touroIatf;
  const toque = String(r.toque_iatf || "").trim().toLowerCase();
  const gestUlt = ult ? diasEntre(ult, dataNasc) : "";
  if (gestUlt !== "" && (gestUlt < 100 || gestUlt > 400)) return null; // IA de outra safra

  let s;
  if (toque === "prenha" && iatf) s = { pai: touroIatf, base: iatf, origem: `IATF ${fmtData(iatf)} (toque prenha)` };
  else if (ult && ult !== iatf) s = { pai: touroUlt, base: ult, origem: `Repasse: IA ${fmtData(ult)}${toque === "vazia" ? " (IATF vazia)" : ""}` };
  else if (toque === "vazia") s = { pai: touroIatf, base: iatf, origem: `IATF ${fmtData(iatf)} deu vazia, sem outra IA: confira se foi monta natural` };
  else s = { pai: touroUlt, base: ult, origem: `IA ${fmtData(ult)} (sem toque registrado)` };
  return { ...s, gestacao: s.base ? diasEntre(s.base, dataNasc) : "", gestUlt, dataUlt: ult, touroUlt };
}

function aoMudarMae() {
  const sug = sugestaoReproducao(campo("mae").value, campo("data").value);
  const pai = campo("pai");
  const gUlt = campo("gest_ult");
  form().dataset.gestacao = sug?.gestacao ?? "";
  if (pai.dataset.manual !== "1") pai.value = sug ? sug.pai : (campo("mae").value.trim() ? "Monta natural" : "");
  if (gUlt.dataset.manual !== "1") gUlt.value = sug?.gestUlt ?? "";
  $("#dica-pai").textContent = sug
    ? `${sug.origem}${sug.gestacao !== "" ? ` · ${sug.gestacao} dias` : ""} · última IA: ${fmtData(sug.dataUlt)} (${sug.touroUlt})`
    : (campo("mae").value.trim() ? "Vaca sem IA registrada na aba Reproducao." : "");
  avisoDuplicado();
}

function avisoDuplicado() {
  const m = normId(campo("mae").value);
  const data = campo("data").value;
  const aviso = $("#aviso");
  const anterior = ativos().find((r) => r.id !== editId && normId(r.mae) === m && Math.abs(diasEntre(r.data, data)) <= 60);
  aviso.hidden = !anterior;
  if (anterior) aviso.textContent = `Atenção: a mãe ${anterior.mae} já tem um parto registrado em ${fmtData(anterior.data)}. Se forem gêmeos, marque "Gêmeos? Sim".`;
}

// Brincos abrem no teclado numérico; o botão ABC/123 troca para letras quando precisar
function modoTeclado(btn, letras) {
  const inp = campo(btn.dataset.alvo);
  inp.inputMode = letras ? "text" : "numeric";
  btn.textContent = letras ? "123" : "ABC";
  btn.setAttribute("aria-label", letras ? "Trocar para números" : "Trocar para letras");
}

function alternarTeclado(btn) {
  const inp = campo(btn.dataset.alvo);
  modoTeclado(btn, inp.inputMode !== "text");
  inp.blur();
  inp.focus(); // reabre o teclado já no novo modo
}

function limparForm() {
  editId = null;
  form().reset();
  campo("data").value = hojeISO();
  campo("pai").dataset.manual = "";
  campo("gest_ult").dataset.manual = "";
  form().dataset.gestacao = "";
  marcarSeg("seg-sexo", "Não sei");
  marcarSeg("seg-sexo2", "Não sei");
  marcarSeg("seg-gemeo", "Não");
  $("#dica-pai").textContent = "";
  $$(".btn-teclado").forEach((b) => modoTeclado(b, false));
  $("#aviso").hidden = true;
  $("#form-titulo").textContent = "Registrar nascimento";
  $("#btn-salvar").textContent = "Salvar registro";
  $("#btn-cancelar").hidden = true;
  $$(".erro", form()).forEach((e) => e.classList.remove("erro"));
}

function editar(id) {
  const r = registros.find((x) => x.id === id);
  if (!r) return;
  limparForm();
  editId = id;
  for (const k of ["data", "mae", "pai", "situacao", "peso", "brinco", "gest_ult", "obs"]) campo(k).value = r[k] ?? "";
  campo("pai").dataset.manual = "1";
  campo("gest_ult").dataset.manual = "1";
  form().dataset.gestacao = r.gestacao ?? "";
  marcarSeg("seg-sexo", r.sexo || "Não sei");
  marcarSeg("seg-gemeo", r.gemeo === "Sim" ? "Sim" : "Não");
  $("#form-titulo").textContent = `Editando parto da mãe ${r.mae}`;
  $("#btn-salvar").textContent = "Salvar alterações";
  $("#btn-cancelar").hidden = false;
  mostrarAba("registrar");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function excluir(id) {
  const r = registros.find((x) => x.id === id);
  if (!r || !confirm(`Excluir o registro da mãe ${r.mae} (${fmtData(r.data)})?`)) return;
  Object.assign(r, { excluido: true, atualizado_em: new Date().toISOString(), _pendente: true });
  await db.gravar(r);
  renderTudo();
  toast("Registro excluído.");
  sincronizar();
}

async function salvar(ev) {
  ev.preventDefault();
  const f = form();
  const obrig = ["data", "mae"].filter((k) => !campo(k).value.trim());
  $$(".erro", f).forEach((e) => e.classList.remove("erro"));
  obrig.forEach((k) => campo(k).classList.add("erro"));
  if (obrig.length) { toast("Preencha a data e a mãe."); campo(obrig[0]).focus(); return; }
  if (campo("data").value > hojeISO()) { campo("data").classList.add("erro"); toast("A data não pode ser no futuro."); return; }

  const agora = new Date().toISOString();
  const antigo = editId ? registros.find((r) => r.id === editId) : null;
  const peso = campo("peso").value ? Number(String(campo("peso").value).replace(",", ".")) : "";
  const gemeo = valorSeg("seg-gemeo");
  const rec = {
    ...(antigo || {}),
    id: editId || novoId(),
    data: campo("data").value,
    mae: campo("mae").value.trim(),
    pai: campo("pai").value.trim(),
    sexo: valorSeg("seg-sexo"),
    situacao: campo("situacao").value,
    peso,
    brinco: campo("brinco").value.trim(),
    gestacao: f.dataset.gestacao ? Number(f.dataset.gestacao) : "",
    gest_ult: campo("gest_ult").value ? Number(campo("gest_ult").value) : "",
    gemeo,
    obs: campo("obs").value.trim(),
    registrado_por: antigo?.registrado_por || usuario?.email || "demo",
    criado_em: antigo?.criado_em || agora,
    atualizado_em: agora,
    excluido: false,
    _pendente: true,
  };
  // Gêmeos: uma linha por terneiro, repetindo os dados do parto (sexo, brinco, peso e situação são de cada um)
  const novos = [rec];
  if (gemeo === "Sim" && !$("#bloco-gemeo").hidden) {
    const peso2 = campo("peso2").value ? Number(String(campo("peso2").value).replace(",", ".")) : "";
    novos.push({ ...rec, id: novoId(), sexo: valorSeg("seg-sexo2"), brinco: campo("brinco2").value.trim(), peso: peso2, situacao: campo("situacao2").value, criado_em: agora, registrado_por: usuario?.email || "demo" });
  }
  await db.gravarVarios(novos);
  registros = await db.todos();
  toast(antigo ? "Alterações salvas." : novos.length > 1 ? `Parto gemelar da mãe ${rec.mae} registrado (2 terneiros).` : `Parto da mãe ${rec.mae} registrado.`);
  limparForm();
  renderTudo();
  campo("mae").focus();
  sincronizar();
}

// =====================================================================
// Listas (últimos registros e consulta)
// =====================================================================
const ordenar = (a, b) => (b.data || "").localeCompare(a.data || "") || (b.criado_em || "").localeCompare(a.criado_em || "");

function cartao(r) {
  const tipo = ehPerda(r) ? "perda" : r.situacao === "Enxertado" ? "enx" : "";
  const [a, m, d] = (r.data || "--").split("-");
  const info = [
    r.sexo && r.sexo !== "Não sei" ? r.sexo : "Sexo não identificado",
    r.peso !== "" && r.peso != null ? `${fmtNum(r.peso, r.peso % 1 ? 1 : 0)} kg` : "",
    r.brinco ? `Brinco ${esc(r.brinco)}` : "",
    r.pai ? `Pai: ${esc(r.pai)}` : "",
    r.gestacao ? `Gestação: ${r.gestacao}d` : "",
    r.gest_ult && r.gest_ult !== r.gestacao ? `Últ. IA: ${r.gest_ult}d` : "",
  ].filter(Boolean);
  return `
    <article class="reg ${tipo}">
      <div class="reg-data"><b>${d}/${m}</b><span>${a}</span></div>
      <div>
        <div class="reg-mae">Mãe ${esc(r.mae)} <span class="badge ${tipo}">${esc(r.situacao)}</span>${r.gemeo === "Sim" ? `<span class="badge gem">Gêmeo</span>` : ""}</div>
        <div class="reg-info">${info.map((i) => `<span>${i}</span>`).join("")}</div>
        ${r.obs ? `<div class="reg-obs">${esc(r.obs)}</div>` : ""}
      </div>
      <div class="reg-dir">
        <span class="estado ${r._pendente ? "pend" : ""}">${r._pendente ? "⏳ aguardando envio" : "✓ sincronizado"}</span>
        <div class="btns">
          <button class="btn-light" data-editar="${r.id}">Editar</button>
          <button class="btn-light perigo" data-excluir="${r.id}">Excluir</button>
        </div>
      </div>
    </article>`;
}

function filtrados() {
  const q = $("#busca").value.trim().toLowerCase();
  const sit = $("#f-situacao").value;
  const sx = $("#f-sexo").value;
  const ano = $("#f-ano").value;
  return ativos().filter((r) => {
    if (ano && !r.data?.startsWith(ano)) return false;
    if (sx && r.sexo !== sx) return false;
    if (sit === "vivos" && !ehVivo(r)) return false;
    if (sit === "perdas" && !ehPerda(r)) return false;
    if (sit && sit !== "vivos" && sit !== "perdas" && r.situacao !== sit) return false;
    if (q && ![r.mae, r.brinco, r.pai, r.obs].some((v) => String(v ?? "").toLowerCase().includes(q))) return false;
    return true;
  }).sort(ordenar);
}

function renderListas() {
  const ult = ativos().sort(ordenar).slice(0, 5);
  $("#ultimos").innerHTML = ult.length ? ult.map(cartao).join("") : `<p class="vazio">Nenhum nascimento registrado ainda.</p>`;

  const lista = filtrados();
  $("#contagem").textContent = `${lista.length} registro${lista.length === 1 ? "" : "s"}`;
  $("#lista").innerHTML = lista.length
    ? lista.slice(0, limiteLista).map(cartao).join("")
    : `<p class="vazio card">Nenhum registro encontrado com esses filtros.</p>`;
  $("#btn-mais").hidden = lista.length <= limiteLista;
}

function preencherAnos() {
  const anos = [...new Set(ativos().map((r) => r.data?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const atualF = $("#f-ano").value;
  const atualP = $("#p-ano").value;
  $("#f-ano").innerHTML = `<option value="">Todos os anos</option>` + anos.map((a) => `<option>${a}</option>`).join("");
  $("#p-ano").innerHTML = anos.map((a) => `<option>${a}</option>`).join("") + `<option value="">Todos os anos</option>`;
  $("#f-ano").value = anos.includes(atualF) ? atualF : "";
  $("#p-ano").value = anos.includes(atualP) || atualP === "" && $("#p-ano").dataset.escolhido ? atualP : (anos[0] || "");

  const pais = [...new Set(ativos().map((r) => r.pai).concat(reproducao.map((r) => r.touro)).filter(Boolean))];
  $("#lista-pais").innerHTML = pais.map((p) => `<option value="${esc(p)}">`).join("");
}

function baixarCsv() {
  const cols = ["data", "mae", "pai", "sexo", "situacao", "peso", "brinco", "gemeo", "gestacao", "gest_ult", "obs", "registrado_por"];
  const cab = ["Data", "Mãe", "Pai", "Sexo", "Situação", "Peso (kg)", "Brinco terneiro", "Gêmeo", "Gestação (dias)", "Gestação última IA (dias)", "Observações", "Registrado por"];
  const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = filtrados().map((r) => cols.map((c) => cel(c === "data" ? fmtData(r.data) : c === "peso" && r.peso !== "" ? String(r.peso).replace(".", ",") : r[c])).join(";"));
  const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `nascimentos-${hojeISO()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// =====================================================================
// Painel
// =====================================================================
function renderPainel() {
  const ano = $("#p-ano").value;
  const base = ativos().filter((r) => !ano || r.data?.startsWith(ano));
  const vivos = base.filter(ehVivo);
  const perdas = base.filter(ehPerda);
  const comPeso = base.filter((r) => r.peso !== "" && r.peso != null && Number(r.peso) > 0);
  const pesoMedio = comPeso.length ? comPeso.reduce((s, r) => s + Number(r.peso), 0) / comPeso.length : null;
  const pct = (n, d) => (d ? `${fmtNum((n / d) * 100, 1)}%` : "–");

  const kpi = (valor, rotulo, extra = "", cls = "") => `<div class="kpi ${cls}"><b>${valor}</b><span>${rotulo}</span>${extra ? `<small>${extra}</small>` : ""}</div>`;
  $("#kpis").innerHTML = [
    kpi(base.length, "Total"),
    kpi(vivos.length, "Vivos", pct(vivos.length, base.length), "vivo"),
    kpi(vivos.filter((r) => r.sexo === "Fêmea").length, "Fêmeas", "vivas"),
    kpi(vivos.filter((r) => r.sexo === "Macho").length, "Machos", "vivos"),
    kpi(perdas.length, "Perdas", pct(perdas.length, base.length), "perda"),
    kpi(pesoMedio ? fmtNum(pesoMedio, 1) : "–", "Peso médio (kg)", comPeso.length ? `${comPeso.length} pesados` : ""),
    kpi(base.filter((r) => r.gemeo === "Sim").length, "Gêmeos", "terneiros"),
  ].join("");

  const porMes = Array(12).fill(0);
  base.forEach((r) => { const m = Number(r.data?.slice(5, 7)); if (m) porMes[m - 1]++; });
  const maxMes = Math.max(1, ...porMes);
  $("#g-mes").innerHTML = porMes.map((n, i) =>
    `<div class="col" title="${MESES[i]}: ${n}">${n ? `<em>${n}</em>` : ""}<i style="height:${(n / maxMes) * 100}%"></i><span>${MESES[i][0]}</span></div>`
  ).join("");

  const sits = ["Vivo", "Enxertado", ...PERDAS];
  const maxSit = Math.max(1, ...sits.map((s) => base.filter((r) => r.situacao === s).length));
  $("#g-sit").innerHTML = sits.map((s) => {
    const n = base.filter((r) => r.situacao === s).length;
    const cls = PERDAS.includes(s) ? "perda" : s === "Enxertado" ? "enx" : "";
    return `<div class="barra ${cls}"><span>${s}</span><div class="trilho"><i style="width:${(n / maxSit) * 100}%"></i></div><b>${n}</b></div>`;
  }).join("");

  const pais = {};
  base.forEach((r) => {
    const p = r.pai || "Não informado";
    const g = (pais[p] ||= { n: 0, vivos: 0, machos: 0, femeas: 0, pesos: [], gest: [] });
    g.n++;
    if (ehVivo(r)) g.vivos++;
    if (r.sexo === "Macho") g.machos++;
    if (r.sexo === "Fêmea") g.femeas++;
    if (Number(r.peso) > 0) g.pesos.push(Number(r.peso));
    if (Number(r.gestacao) > 0) g.gest.push(Number(r.gestacao));
  });
  const media = (a, c = 1) => (a.length ? fmtNum(a.reduce((s, x) => s + x, 0) / a.length, c) : "–");
  const linhas = Object.entries(pais).sort((a, b) => b[1].n - a[1].n);
  $("#t-pai").innerHTML = linhas.length ? `
    <table>
      <thead><tr><th>Pai</th><th class="n">Nasc.</th><th class="n">Vivos</th><th class="n">F / M</th><th class="n">Peso médio</th><th class="n">Gestação</th></tr></thead>
      <tbody>${linhas.map(([p, g]) => `
        <tr><td>${esc(p)}</td><td class="n">${g.n}</td><td class="n">${pct(g.vivos, g.n)}</td><td class="n">${g.femeas} / ${g.machos}</td><td class="n">${media(g.pesos)}</td><td class="n">${media(g.gest, 0)}</td></tr>`).join("")}
      </tbody>
    </table>` : `<p class="vazio">Sem registros no período.</p>`;
}

// =====================================================================
// Navegação e inicialização
// =====================================================================
function mostrarAba(nome) {
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${nome}`));
  $$(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === nome));
  $("#titulo").textContent = { registrar: "Caderno de Nascimentos", consulta: "Consulta de Nascimentos", painel: "Painel do Rebanho" }[nome];
  if (nome !== "registrar") window.scrollTo(0, 0);
}

function renderTudo() {
  preencherAnos();
  renderListas();
  renderPainel();
  atualizarStatus();
}

function entrarNoApp() {
  if (!$("#app").hidden) return;
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#demo").hidden = !DEMO;
  $("#btn-sair").hidden = DEMO;
  $("#quem").textContent = DEMO ? "Modo demonstração" : `Conectado como ${usuario.nome} (${usuario.email}) ·`;
}

function ligarEventos() {
  form().addEventListener("submit", salvar);
  campo("mae").addEventListener("input", aoMudarMae);
  campo("data").addEventListener("change", aoMudarMae);
  campo("pai").addEventListener("input", () => (campo("pai").dataset.manual = campo("pai").value ? "1" : ""));
  ["seg-sexo", "seg-sexo2", "seg-gemeo"].forEach((id) =>
    $(`#${id}`).addEventListener("click", (e) => e.target.dataset.v && marcarSeg(id, e.target.dataset.v)));
  campo("gest_ult").addEventListener("input", () => (campo("gest_ult").dataset.manual = campo("gest_ult").value ? "1" : ""));
  $("#btn-cancelar").addEventListener("click", limparForm);
  $$(".btn-teclado").forEach((b) => {
    b.addEventListener("pointerdown", (e) => e.preventDefault()); // não fecha o teclado ao tocar
    b.addEventListener("click", () => alternarTeclado(b));
  });
  $("#btn-sync").addEventListener("click", () => sincronizar(true));
  $("#btn-sair").addEventListener("click", sair);
  $("#btn-csv").addEventListener("click", baixarCsv);
  $("#btn-mais").addEventListener("click", () => { limiteLista += 60; renderListas(); });
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => mostrarAba(b.dataset.tab)));
  ["#busca", "#f-situacao", "#f-sexo", "#f-ano"].forEach((s) =>
    $(s).addEventListener("input", () => { limiteLista = 60; renderListas(); }));
  $("#p-ano").addEventListener("change", () => { $("#p-ano").dataset.escolhido = "1"; renderPainel(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-editar],[data-excluir]");
    if (b?.dataset.editar) editar(b.dataset.editar);
    if (b?.dataset.excluir) excluir(b.dataset.excluir);
  });
  window.addEventListener("online", () => sincronizar());
  window.addEventListener("offline", atualizarStatus);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sincronizar());
  setInterval(() => pendentes().length && sincronizar(), 2 * 60_000);
}

async function iniciar() {
  try { usuario = JSON.parse(localStorage.getItem("fsr_usuario")); } catch { usuario = null; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(console.warn);
  if (navigator.storage?.persist) navigator.storage.persist();

  registros = await db.todos();
  reproducao = (await db.ler("reproducao")) || [];
  ligarEventos();
  limparForm();
  renderTudo();

  if (DEMO || usuario) {
    // Quem já entrou uma vez usa o app mesmo sem sinal; a planilha confere o acesso a cada envio
    entrarNoApp();
    sincronizar();
  } else {
    $("#login").hidden = false;
    if (!navigator.onLine) $("#login-msg").textContent = "Conecte-se à internet para o primeiro acesso. Depois o app funciona sem sinal.";
  }
}

iniciar();
