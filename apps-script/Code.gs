/**
 * Fazenda Santa Rita — servidor da planilha (Google Apps Script)
 *
 * Cole este arquivo em Extensões > Apps Script da planilha, preencha o CLIENT_ID,
 * rode a função "configurar" uma vez e publique como App da Web (veja o LEIA-ME.md).
 */

const CLIENT_ID = "COLE_AQUI_O_ID_DO_CLIENTE.apps.googleusercontent.com";

const ABA_REGISTROS = "Nascimentos";
const ABA_USUARIOS = "Usuarios";
const ABA_REPRODUCAO = "Reproducao";

const COLUNAS = [
  "id", "data", "mae", "pai", "sexo", "situacao", "peso", "brinco", "gestacao", "obs",
  "registrado_por", "alterado_por", "criado_em", "atualizado_em", "sincronizado_em", "excluido",
];
const CABECALHO = [
  "ID", "Data", "Mãe", "Pai", "Sexo", "Situação", "Peso (kg)", "Brinco terneiro", "Gestação (dias)", "Observações",
  "Registrado por", "Alterado por", "Criado em", "Atualizado em", "Sincronizado em", "Excluído",
];
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
    rep.getRange(1, 1, 1, 4).setValues([["Mãe", "Data da IA/IATF", "Touro", "Tipo (IA/IATF/Repasse)"]]).setFontWeight("bold");
    rep.getRange("A:A").setNumberFormat("@");
    rep.getRange("B:B").setNumberFormat("dd/mm/yyyy");
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
    const usuario = verificarUsuario_(req.token);
    if (req.action === "ping") saida = { ok: true, usuario: usuario };
    else if (req.action === "sync") saida = sincronizar_(req.registros || [], usuario);
    else throw erro_("Ação desconhecida.", "ACAO");
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

function paraLinha_(r) {
  return COLUNAS.map((c) => {
    const v = r[c];
    if (c === "data" && v) {
      const p = String(v).split("-");
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    if (c === "excluido") return v === true;
    return v === undefined || v === null ? "" : v;
  });
}

function lerReproducao_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_REPRODUCAO);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter((l) => l[0] !== "" && l[1] !== "")
    .map((l) => ({
      mae: String(l[0]).trim(),
      data_ia: l[1] instanceof Date
        ? Utilities.formatDate(l[1], tz, "yyyy-MM-dd")
        : String(l[1]).trim().replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1"),
      touro: String(l[2]).trim(),
      tipo: String(l[3]).trim(),
    }));
}

function erro_(msg, codigo) {
  const e = new Error(msg);
  e.codigo = codigo;
  return e;
}
