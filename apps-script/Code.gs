/**
 * Fazenda Santa Rita — servidor da planilha (Google Apps Script)
 *
 * Cole este arquivo em Extensões > Apps Script da planilha, preencha o CLIENT_ID,
 * rode a função "configurar" uma vez e publique como App da Web (veja o LEIA-ME.md).
 */

const CLIENT_ID = "997988874349-65tdu4nmrtj1p4sgg291ftg4b1dfna7i.apps.googleusercontent.com";

const ABA_REGISTROS = "Nascimentos";
const ABA_USUARIOS = "Usuarios";
const ABA_REPRODUCAO = "Reproducao";
const ABA_APARELHOS = "Aparelhos";

// Aba Aparelhos: um aparelho liberado por linha. A chave fica só no celular;
// aqui guardamos apenas o "resumo" dela (coluna oculta), que não serve para entrar.
const CABECALHO_APARELHOS = ["Código", "E-mail", "Nome", "Aparelho", "Liberado em", "Último uso", "Ativo (SIM/NÃO)", "Resumo da chave (não editar)"];

const COLUNAS = [
  "id", "data", "mae", "pai", "sexo", "situacao", "peso", "brinco", "gestacao", "obs",
  "registrado_por", "alterado_por", "criado_em", "atualizado_em", "sincronizado_em", "excluido",
  "gemeo", "gest_ult",
];
const CABECALHO = [
  "ID", "Data", "Mãe", "Pai", "Sexo", "Situação", "Peso (kg)", "Brinco terneiro", "Gestação (dias)", "Observações",
  "Registrado por", "Alterado por", "Criado em", "Atualizado em", "Sincronizado em", "Excluído",
  "Gêmeo", "Gestação última IA (dias)",
];
// Aba Reproducao: uma linha por vaca
const CABECALHO_REPRODUCAO = ["Mãe", "Data IATF", "Touro IATF", "Toque IATF", "Data última IA", "Touro última IA"];
const COLUNAS_TEXTO = ["id", "mae", "pai", "brinco", "criado_em", "atualizado_em"];

// ---------------------------------------------------------------------
// Rode UMA vez pelo editor (botão Executar) para criar as abas
// ---------------------------------------------------------------------
function configurar() {
  const ss = SpreadsheetApp.getActive();

  const reg = ss.getSheetByName(ABA_REGISTROS) || ss.insertSheet(ABA_REGISTROS);
  reg.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight("bold").setBackground("#1f3a2c").setFontColor("#ffffff");
  reg.setFrozenRows(1);
  COLUNAS_TEXTO.forEach((c) => {
    const col = COLUNAS.indexOf(c) + 1;
    reg.getRange(2, col, reg.getMaxRows() - 1, 1).setNumberFormat("@");
  });
  reg.getRange(2, COLUNAS.indexOf("data") + 1, reg.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
  reg.hideColumns(1);

  const usu = ss.getSheetByName(ABA_USUARIOS) || ss.insertSheet(ABA_USUARIOS);
  if (usu.getLastRow() === 0) {
    usu.getRange(1, 1, 1, 3).setValues([["E-mail", "Nome", "Ativo (SIM/NÃO)"]]).setFontWeight("bold");
    usu.appendRow([Session.getEffectiveUser().getEmail(), "Administrador", "SIM"]);
    usu.setFrozenRows(1);
  }

  const rep = ss.getSheetByName(ABA_REPRODUCAO) || ss.insertSheet(ABA_REPRODUCAO);
  if (rep.getLastRow() === 0) {
    rep.getRange(1, 1, 1, CABECALHO_REPRODUCAO.length).setValues([CABECALHO_REPRODUCAO]).setFontWeight("bold");
    rep.getRange("A:A").setNumberFormat("@");
    rep.getRange("B:B").setNumberFormat("dd/mm/yyyy");
    rep.getRange("E:E").setNumberFormat("dd/mm/yyyy");
    rep.setFrozenRows(1);
  }
  const vazia = ss.getSheetByName("Página1") || ss.getSheetByName("Sheet1");
  if (vazia && vazia.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(vazia);
}

// ---------------------------------------------------------------------
// Entrada do App da Web
// ---------------------------------------------------------------------
function doPost(e) {
  let saida;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.action === "registrar") {
      // Primeiro acesso no aparelho: login Google confere o e-mail e libera uma chave permanente
      const u = verificarUsuario_(req.token);
      saida = { ok: true, usuario: u, chave: registrarAparelho_(u, req.aparelho) };
    } else {
      const usuario = req.chave ? verificarAparelho_(req.chave) : verificarUsuario_(req.token);
      if (req.action === "ping") saida = { ok: true, usuario: usuario };
      else if (req.action === "sync") saida = sincronizar_(req.registros || [], usuario);
      else if (req.action === "sair") { desativarAparelho_(req.chave); saida = { ok: true }; }
      else throw erro_("Ação desconhecida.", "ACAO");
    }
  } catch (err) {
    saida = { ok: false, erro: String(err.message || err), codigo: err.codigo || "ERRO" };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput("Fazenda Santa Rita: servidor ativo.");
}

// ---------------------------------------------------------------------
// Login: confere o token do Google e a lista de usuários autorizados
// ---------------------------------------------------------------------
function verificarUsuario_(token) {
  if (!token) throw erro_("Faça login com sua conta Google.", "AUTH");

  const cache = CacheService.getScriptCache();
  const chave = "tk_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  let email = cache.get(chave);

  if (!email) {
    const r = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
      { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw erro_("Sessão expirada. Entre novamente.", "AUTH");
    const info = JSON.parse(r.getContentText());
    if (info.aud !== CLIENT_ID) throw erro_("Login emitido para outro aplicativo.", "AUTH");
    if (String(info.email_verified) !== "true") throw erro_("E-mail Google não verificado.", "AUTH");
    email = String(info.email).toLowerCase();
    const restante = Math.max(60, Math.min(21600, Number(info.exp) - Math.floor(Date.now() / 1000) - 30));
    cache.put(chave, email, restante);
  }

  const aut = usuariosAutorizados_()[email];
  if (!aut) throw erro_("O e-mail " + email + " não está autorizado. Peça ao administrador para incluí-lo na aba Usuarios.", "NEGADO");
  return { email: email, nome: aut.nome || email };
}

// ---------------------------------------------------------------------
// Aparelhos liberados (chave permanente por celular)
// ---------------------------------------------------------------------
function abaAparelhos_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ABA_APARELHOS);
  if (!sh) {
    sh = ss.insertSheet(ABA_APARELHOS);
    sh.getRange(1, 1, 1, CABECALHO_APARELHOS.length).setValues([CABECALHO_APARELHOS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.hideColumns(CABECALHO_APARELHOS.length);
  }
  return sh;
}

// Começa com "k" para a planilha nunca confundir o texto com fórmula ou número
function resumo_(chave) {
  return "k" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(chave))).replace(/=+$/, "");
}

function registrarAparelho_(usuario, aparelho) {
  const chave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  const r = resumo_(chave);
  const agora = new Date();
  abaAparelhos_().appendRow([r.slice(1, 7).toUpperCase(), usuario.email, usuario.nome,
    String(aparelho || "").slice(0, 60), agora, agora, "SIM", r]);
  return chave;
}

function linhaAparelho_(sh, chave) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return null;
  const r = resumo_(chave);
  const col = sh.getRange(2, CABECALHO_APARELHOS.length, n, 1).getValues();
  for (let i = 0; i < n; i++) if (col[i][0] === r) return i + 2;
  return null;
}

function verificarAparelho_(chave) {
  const sh = abaAparelhos_();
  const linha = linhaAparelho_(sh, chave);
  if (!linha) throw erro_("Este aparelho não está liberado. Entre com o Google para liberá-lo.", "APARELHO");
  const l = sh.getRange(linha, 1, 1, CABECALHO_APARELHOS.length).getValues()[0];
  const ativo = String(l[6]).trim().toUpperCase();
  if (ativo === "NÃO" || ativo === "NAO") throw erro_("Este aparelho foi bloqueado. Entre com o Google para liberá-lo de novo.", "APARELHO");
  const email = String(l[1]).trim().toLowerCase();
  const aut = usuariosAutorizados_()[email];
  if (!aut) throw erro_("O e-mail " + email + " não está autorizado. Peça ao administrador para incluí-lo na aba Usuarios.", "NEGADO");
  sh.getRange(linha, 6).setValue(new Date());
  return { email: email, nome: aut.nome || email };
}

function desativarAparelho_(chave) {
  const sh = abaAparelhos_();
  const linha = linhaAparelho_(sh, chave);
  if (linha) sh.getRange(linha, 7).setValue("NÃO");
}

function usuariosAutorizados_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_USUARIOS);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach((l) => {
    const email = String(l[0]).trim().toLowerCase();
    const ativo = String(l[2]).trim().toUpperCase();
    if (email && ativo !== "NÃO" && ativo !== "NAO") mapa[email] = { nome: String(l[1]).trim() };
  });
  return mapa;
}

// ---------------------------------------------------------------------
// Sincronização: grava o que veio do celular e devolve a base completa
// ---------------------------------------------------------------------
function sincronizar_(recebidos, usuario) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(ABA_REGISTROS);
    garantirCabecalho_(sh);
    const base = lerRegistros_(sh);
    const agora = new Date().toISOString();
    const novos = [];

    recebidos.forEach((r) => {
      if (!r || !r.id) return;
      const pos = base.indice[r.id];
      if (pos !== undefined) {
        const atual = base.lista[pos];
        if (String(atual.atualizado_em) >= String(r.atualizado_em)) return; // a planilha já tem versão igual ou mais nova
        r.registrado_por = atual.registrado_por;
        r.criado_em = atual.criado_em;
        r.alterado_por = usuario.email;
        r.sincronizado_em = agora;
        sh.getRange(pos + 2, 1, 1, COLUNAS.length).setValues([paraLinha_(r)]);
        base.lista[pos] = r;
      } else {
        r.registrado_por = usuario.email; // quem enviou, conferido pelo login
        r.alterado_por = "";
        r.sincronizado_em = agora;
        base.indice[r.id] = base.lista.length;
        base.lista.push(r);
        novos.push(paraLinha_(r));
      }
    });

    if (novos.length) {
      sh.getRange(sh.getLastRow() + 1, 1, novos.length, COLUNAS.length).setValues(novos);
    }
    return { ok: true, usuario: usuario, registros: base.lista, reproducao: lerReproducao_() };
  } finally {
    lock.releaseLock();
  }
}

// Acrescenta colunas novas (ex.: Gêmeo) no cabeçalho de planilhas criadas antes delas
function garantirCabecalho_(sh) {
  const atual = sh.getRange(1, 1, 1, CABECALHO.length).getValues()[0];
  if (atual.join("|") !== CABECALHO.join("|")) sh.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
}

function lerRegistros_(sh) {
  const lista = [];
  const indice = {};
  const n = sh.getLastRow() - 1;
  if (n < 1) return { lista: lista, indice: indice };
  const tz = Session.getScriptTimeZone();
  sh.getRange(2, 1, n, COLUNAS.length).getValues().forEach((l) => {
    const r = {};
    COLUNAS.forEach((c, i) => {
      let v = l[i];
      if (v instanceof Date) v = c === "data" ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v.toISOString();
      r[c] = v;
    });
    r.excluido = r.excluido === true || String(r.excluido).toUpperCase() === "TRUE";
    if (!r.id) return;
    indice[r.id] = lista.length;
    lista.push(r);
  });
  return { lista: lista, indice: indice };
}

// Monta natural: não há como saber o tempo de gestação, então a coluna fica em branco
const ehMontaNatural_ = (pai) => /^\s*monta\s+natural\s*$/i.test(String(pai || ""));

function paraLinha_(r) {
  return COLUNAS.map((c) => {
    const v = r[c];
    if (c === "gestacao" && ehMontaNatural_(r.pai)) return "";
    if (c === "data" && v) {
      const p = String(v).split("-");
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    if (c === "excluido") return v === true;
    if (c === "gemeo") return v === "Sim" ? "Sim" : "Não";
    return v === undefined || v === null ? "" : v;
  });
}

function lerReproducao_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_REPRODUCAO);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const data = (v) => v instanceof Date
    ? Utilities.formatDate(v, tz, "yyyy-MM-dd")
    : String(v).trim().replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, d, m, a) => a + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2));
  return sh.getRange(2, 1, sh.getLastRow() - 1, CABECALHO_REPRODUCAO.length).getValues()
    .filter((l) => String(l[0]).trim() !== "" && (l[1] !== "" || l[4] !== ""))
    .map((l) => ({
      mae: String(l[0]).trim(),
      data_iatf: l[1] === "" ? "" : data(l[1]),
      touro_iatf: String(l[2]).trim(),
      toque_iatf: String(l[3]).trim(),
      data_ult: l[4] === "" ? "" : data(l[4]),
      touro_ult: String(l[5]).trim(),
    }));
}

function erro_(msg, codigo) {
  const e = new Error(msg);
  e.codigo = codigo;
  return e;
}
