// vendas.js — Histórico de Vendas por dia — Gerência Viviane Vargas Stories
// Aba "Histórico de Vendas" dentro da página Caixa (somente admin).
// Mostra, para o dia escolhido: resumo, formas de pagamento, produtos mais vendidos
// e a lista de vendas com o detalhe completo de cada uma (itens, descontos, cliente, etc.).
import {
  collection, doc, getDocs, query, where, orderBy, runTransaction, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, escHtml, exportarExcel } from "../utils/database.js";

const COL_VENDAS = "vv_vendas";
const COL_ITENS  = "vv_venda_itens";
const COL_CONTADORES = "vv_contadores";

let _vendas    = [];     // vendas do dia carregadas (já com itens e totais calculados)
let _abaAtual  = "pdv";
let _ligado    = false;  // listeners presos uma única vez
let _admin     = false;
let _seq       = 0;      // descarta respostas antigas quando o usuário troca de dia rápido

const $ = (id) => document.getElementById(id);
const num = (v) => Number(v) || 0;

// ── Datas ────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const isoLocal  = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inicioDia = (iso) => new Date(`${iso}T00:00:00`);
const fimDia    = (iso) => new Date(`${iso}T23:59:59.999`);
const horaStr   = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function somarDias(iso, delta) {
  const d = inicioDia(iso);
  d.setDate(d.getDate() + delta);
  return isoLocal(d);
}

// ── Cálculos de uma venda ────────────────────────────────────
function detalharVenda(v, lista) {
  const subtotal  = lista.reduce((a, i) => a + num(i.precoUnit) * num(i.qtd), 0);
  const descItens = lista.reduce((a, i) => a + num(i.desconto), 0);
  const base      = subtotal - descItens;
  const dt        = v.descontoTotal || {};
  const descTotal = dt.tipo === "pct" ? base * num(dt.valor) / 100 : num(dt.valor);
  const aposDesc  = Math.max(0, base - descTotal);
  const ac        = v.acrescimo || {};
  const acrescimo = ac.tipo === "pct" ? aposDesc * num(ac.valor) / 100 : num(ac.valor);
  return {
    subtotal, descItens, descTotal, acrescimo,
    qtdItens: lista.reduce((a, i) => a + num(i.qtd), 0)
  };
}

// Pagamento dividido (Múltiplo) vira várias linhas; senão uma linha com o total
function pagamentosDe(v) {
  if (Array.isArray(v.pagamentos) && v.pagamentos.length) {
    return v.pagamentos.map(p => ({ forma: p.forma || "Não informado", valor: num(p.valor) }));
  }
  return [{ forma: v.formaPagamento || "Não informado", valor: num(v.total) }];
}

// ── Carregamento ─────────────────────────────────────────────
async function buscarItens(ids) {
  const mapa = {};
  const blocos = [];
  for (let i = 0; i < ids.length; i += 30) blocos.push(ids.slice(i, i + 30)); // limite do operador "in"
  const snaps = await Promise.all(
    blocos.map(b => getDocs(query(collection(db, COL_ITENS), where("vendaId", "in", b))))
  );
  snaps.forEach(sn => sn.forEach(d => {
    const it = { id: d.id, ...d.data() };
    if (!mapa[it.vendaId]) mapa[it.vendaId] = [];
    mapa[it.vendaId].push(it);
  }));
  return mapa;
}

async function carregarDia() {
  const iso = $("vendDia").value || isoLocal(new Date());
  const cont = $("vendConteudo");
  const seq = ++_seq;

  atualizarRotuloDia(iso);
  cont.innerHTML = `<div class="card"><p class="loading-cell" style="padding:24px">Carregando vendas...</p></div>`;

  try {
    const snap = await getDocs(query(
      collection(db, COL_VENDAS),
      where("data", ">=", Timestamp.fromDate(inicioDia(iso))),
      where("data", "<=", Timestamp.fromDate(fimDia(iso))),
      orderBy("data", "desc")
    ));
    const vendas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const itensPorVenda = vendas.length ? await buscarItens(vendas.map(v => v.id)) : {};
    if (seq !== _seq) return; // chegou resposta de um dia que não é mais o escolhido

    _vendas = vendas.map(v => {
      const lista = (itensPorVenda[v.id] || []).sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
      const dt = v.data?.toDate?.() || v.criadoEm?.toDate?.() || new Date(v.data);
      return { ...v, dt, lista, calc: detalharVenda(v, lista), cancelada: v.status === "cancelada" };
    });

    montarOpcoesForma();
    renderizar();
  } catch (err) {
    console.error(err);
    if (seq !== _seq) return;
    cont.innerHTML = `<div class="card"><p class="empty-cell" style="padding:24px">Erro ao carregar as vendas deste dia.</p></div>`;
  }
}

function atualizarRotuloDia(iso) {
  const el = $("vendDiaLabel");
  if (!el) return;
  const txt = new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric"
  });
  el.textContent = iso === isoLocal(new Date()) ? `${txt} · Hoje` : txt;
}

function montarOpcoesForma() {
  const sel = $("vendFiltroForma");
  if (!sel) return;
  const atual = sel.value;
  const formas = new Set();
  _vendas.forEach(v => pagamentosDe(v).forEach(p => formas.add(p.forma)));
  sel.innerHTML = `<option value="">Todas as formas</option>` +
    [...formas].sort().map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join("");
  sel.value = formas.has(atual) ? atual : "";
}

// ── Filtros da lista ─────────────────────────────────────────
function vendasFiltradas() {
  const forma = $("vendFiltroForma")?.value || "";
  const termo = ($("vendBusca")?.value || "").trim().toLowerCase();
  return _vendas.filter(v => {
    if (forma && !pagamentosDe(v).some(p => p.forma === forma)) return false;
    if (!termo) return true;
    const alvo = [
      v.numero, v.clienteFiadoNome, v.operador, v.cpfCnpj, v.observacoes, v.formaPagamento,
      ...v.lista.map(i => i.nome)
    ].filter(x => x != null).join(" ").toLowerCase();
    return alvo.includes(termo);
  });
}

// ── Renderização ─────────────────────────────────────────────
const ICON_CART  = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3z"/></svg>`;
const ICON_MONEY = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clip-rule="evenodd"/></svg>`;

const dinheiro = (v) => `<span class="prom-valor-sensivel">${formatarMoeda(v)}</span>`;

function kpi(cor, rotulo, valor, icone) {
  return `<div class="stat-card stat-card--${cor}">
    <div class="stat-card__icon">${icone}</div>
    <div class="stat-card__body"><span class="stat-card__label">${rotulo}</span><strong class="stat-card__value stat-card__value--sm">${valor}</strong></div>
  </div>`;
}

function renderizar() {
  const cont = $("vendConteudo");
  if (!cont) return;

  if (!_vendas.length) {
    const iso = $("vendDia").value;
    const quando = iso === isoLocal(new Date()) ? "hoje" : "neste dia";
    cont.innerHTML = `<div class="card"><p class="empty-cell" style="padding:32px">Nenhuma venda registrada ${quando}.</p></div>`;
    return;
  }

  // Resumo do dia: só vendas concluídas (canceladas ficam de fora, igual ao fechamento de caixa)
  const validas = _vendas.filter(v => !v.cancelada);
  const canceladas = _vendas.length - validas.length;
  const faturamento = validas.reduce((a, v) => a + num(v.total), 0);
  const ticket = validas.length ? faturamento / validas.length : 0;
  const itensVendidos = validas.reduce((a, v) => a + v.calc.qtdItens, 0);
  const descontos = validas.reduce((a, v) => a + v.calc.descItens + v.calc.descTotal, 0);
  const fiado = validas
    .filter(v => v.formaPagamento === "Fiado")
    .reduce((a, v) => a + num(v.total), 0);

  // Por forma de pagamento
  const porForma = {};
  validas.forEach(v => pagamentosDe(v).forEach(p => { porForma[p.forma] = (porForma[p.forma] || 0) + p.valor; }));
  const totalFormas = Object.values(porForma).reduce((a, b) => a + b, 0);
  const formasHtml = Object.entries(porForma).sort((a, b) => b[1] - a[1]).map(([forma, valor]) => {
    const pct = totalFormas ? (valor / totalFormas) * 100 : 0;
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:var(--text-sm)">
        <span>${escHtml(forma)}</span>
        <span><strong>${dinheiro(valor)}</strong> <small style="color:var(--gray-400)">${pct.toFixed(0)}%</small></span>
      </div>
      <div style="height:6px;background:var(--gray-100);border-radius:9999px;margin-top:5px">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:#B79061;border-radius:9999px"></div>
      </div>
    </div>`;
  }).join("") || `<p class="empty-cell">Sem dados.</p>`;

  // Produtos mais vendidos
  const porProduto = {};
  validas.forEach(v => v.lista.forEach(i => {
    const k = i.produtoId || i.nome || "—";
    if (!porProduto[k]) porProduto[k] = { nome: i.nome || "—", qtd: 0, total: 0 };
    porProduto[k].qtd += num(i.qtd);
    porProduto[k].total += num(i.total);
  }));
  const top = Object.values(porProduto).sort((a, b) => b.qtd - a.qtd || b.total - a.total).slice(0, 5);
  const topHtml = top.length
    ? `<table class="data-table" style="font-size:var(--text-sm)">
        <thead><tr><th>Produto</th><th style="text-align:center">Qtd.</th><th>Total</th></tr></thead>
        <tbody>${top.map(p => `<tr><td>${escHtml(p.nome)}</td><td style="text-align:center"><strong>${p.qtd}</strong></td><td>${dinheiro(p.total)}</td></tr>`).join("")}</tbody>
      </table>`
    : `<p class="empty-cell">Sem itens registrados.</p>`;

  // Lista de vendas (respeita filtros)
  const lista = vendasFiltradas();
  const numerosDoDia = new Set();
  const numerosDuplicados = _vendas.some((v) => {
    const numero = Number(v.numero);
    if (!Number.isFinite(numero) || numero <= 0) return true;
    if (numerosDoDia.has(numero)) return true;
    numerosDoDia.add(numero);
    return false;
  });
  const linhas = lista.length ? lista.map(linhaVenda).join("") :
    `<tr><td colspan="8" class="empty-cell">Nenhuma venda encontrada com esse filtro.</td></tr>`;
  const cancelTxt = canceladas ? ` · ${canceladas} cancelada${canceladas > 1 ? "s" : ""}` : "";

  cont.innerHTML = `
    <div class="stats-grid" style="margin-bottom:var(--space-4)">
      ${kpi("blue",   "Vendas",          String(validas.length) + cancelTxt, ICON_CART)}
      ${kpi("green",  "Faturamento",     formatarMoeda(faturamento),         ICON_MONEY)}
      ${kpi("purple", "Ticket médio",    formatarMoeda(ticket),              ICON_MONEY)}
      ${kpi("blue",   "Itens vendidos",  String(itensVendidos),              ICON_CART)}
      ${kpi("gold",   "Descontos dados", formatarMoeda(descontos),           ICON_MONEY)}
      ${kpi("red",    "Fiado (a receber)", formatarMoeda(fiado),             ICON_MONEY)}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--space-4);margin-bottom:var(--space-4)">
      <div class="card">
        <div class="card-header"><h3 class="card-section-title">Por forma de pagamento</h3></div>
        <div style="padding:var(--space-4) var(--space-5)">${formasHtml}</div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-section-title">Mais vendidos do dia</h3></div>
        <div class="table-wrap">${topHtml}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 class="card-section-title">Vendas do dia</h3>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${numerosDuplicados ? `<button type="button" class="btn-ghost btn-sm" id="btnRepararNumerosVendas">Corrigir numeração duplicada</button>` : ""}
          <small style="color:var(--gray-400)">Mostrando ${lista.length} de ${_vendas.length} · clique numa venda para ver o detalhe</small>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:28px"></th><th>#</th><th>Hora</th><th>Pagamento</th><th>Cliente</th><th>Operador</th>
            <th style="text-align:center">Itens</th><th>Total</th>
          </tr></thead>
          <tbody id="vendTbody">${linhas}</tbody>
        </table>
      </div>
    </div>`;

  document.getElementById("btnRepararNumerosVendas")?.addEventListener("click", repararNumerosDuplicados);
}

// Corrige apenas vendas que já nasceram com número repetido pela versão antiga.
// Mantém a primeira ocorrência e atribui números novos às repetições, com confirmação do administrador.
async function repararNumerosDuplicados() {
  if (!window.confirm("Corrigir apenas os números duplicados das vendas? A primeira venda de cada número será preservada e as repetições receberão novos números.")) return;

  try {
    const snap = await getDocs(collection(db, COL_VENDAS));
    const vendas = snap.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => {
        const dataA = a.data?.toMillis?.() || a.criadoEm?.toMillis?.() || 0;
        const dataB = b.data?.toMillis?.() || b.criadoEm?.toMillis?.() || 0;
        return dataA - dataB || String(a.id).localeCompare(String(b.id));
      });

    const usados = new Set();
    let maiorNumero = 0;
    const duplicados = [];
    vendas.forEach((venda) => {
      const numero = Number(venda.numero);
      maiorNumero = Math.max(maiorNumero, Number.isFinite(numero) ? numero : 0);
      if (!Number.isFinite(numero) || numero <= 0 || usados.has(numero)) duplicados.push(venda);
      else usados.add(numero);
    });

    if (!duplicados.length) {
      window.mostrarToast("Não há numeração duplicada para corrigir.", "success");
      return;
    }
    if (duplicados.length > 400) throw new Error("Há muitas vendas duplicadas para corrigir de uma vez. Solicite uma revisão do administrador.");

    const contadorRef = doc(db, COL_CONTADORES, "vendas");
    await runTransaction(db, async (transacao) => {
      let proximoNumero = maiorNumero;
      duplicados.forEach((venda) => {
        proximoNumero += 1;
        transacao.update(doc(db, COL_VENDAS, venda.id), {
          numeroOriginal: venda.numero ?? null,
          numero: proximoNumero,
          numeroCorrigidoEm: serverTimestamp()
        });
      });
      transacao.set(contadorRef, {
        ultimaVenda: proximoNumero,
        atualizadoEm: serverTimestamp()
      }, { merge: true });
    });

    window.mostrarToast(`${duplicados.length} número(s) de venda foram corrigidos.`, "success");
    await carregarDia();
  } catch (erro) {
    console.error("Erro ao corrigir numeração de vendas:", erro);
    window.mostrarToast(erro.message || "Não foi possível corrigir a numeração.", "error");
  }
}

function badge(txt, bg, cor) {
  return `<span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:${bg};color:${cor}">${txt}</span>`;
}

function linhaVenda(v) {
  const formas = pagamentosDe(v).map(p => p.forma);
  const pagTxt = formas.length > 1 ? formas.join(" + ") : formas[0];
  const totalStyle = v.cancelada ? "text-decoration:line-through;color:var(--gray-400)" : "font-weight:700";
  return `
    <tr class="vend-row" data-vid="${escHtml(v.id)}" style="cursor:pointer">
      <td class="vend-seta" style="color:var(--gray-400)">▸</td>
      <td style="color:var(--gray-500)">#${escHtml(String(v.numero ?? v.id.slice(-4).toUpperCase()))}</td>
      <td>${isNaN(v.dt) ? "—" : horaStr(v.dt)}</td>
      <td>${escHtml(pagTxt)} ${v.cancelada ? badge("Cancelada", "#FEE2E2", "#991B1B") : ""}</td>
      <td style="color:var(--gray-500)">${escHtml(v.clienteFiadoNome || "—")}</td>
      <td style="color:var(--gray-500)">${escHtml(v.operador || "—")}</td>
      <td style="text-align:center">${v.calc.qtdItens || num(v.itens)}</td>
      <td style="${totalStyle}">${dinheiro(v.total)}</td>
    </tr>
    <tr class="vend-det" data-det="${escHtml(v.id)}" style="display:none">
      <td colspan="8" style="background:var(--gray-50);padding:var(--space-4) var(--space-5)">${detalheHtml(v)}</td>
    </tr>`;
}

function linhaResumo(rotulo, valor, destaque = false, cor = "") {
  return `<div style="display:flex;justify-content:space-between;gap:16px;${destaque ? "font-weight:700;border-top:1px solid var(--gray-200);padding-top:6px;margin-top:4px" : ""}">
    <span style="color:var(--gray-500)">${rotulo}</span><span style="${cor ? `color:${cor}` : ""}">${valor}</span>
  </div>`;
}

function detalheHtml(v) {
  const c = v.calc;

  const itens = v.lista.length
    ? `<div class="table-wrap"><table class="data-table" style="font-size:var(--text-xs)">
        <thead><tr><th>Produto</th><th style="text-align:center">Qtd.</th><th>Unitário</th><th>Desconto</th><th>Total</th></tr></thead>
        <tbody>${v.lista.map(i => `<tr>
          <td>${escHtml(i.nome || "—")}</td>
          <td style="text-align:center">${num(i.qtd)}</td>
          <td>${dinheiro(i.precoUnit)}</td>
          <td style="color:${num(i.desconto) > 0 ? "#DC2626" : "var(--gray-400)"}">${num(i.desconto) > 0 ? dinheiro(i.desconto) : "—"}</td>
          <td><strong>${dinheiro(i.total)}</strong></td>
        </tr>`).join("")}</tbody>
      </table></div>`
    : `<p class="empty-cell">Os itens desta venda não foram encontrados.</p>`;

  const pagamentos = pagamentosDe(v).map(p => `${escHtml(p.forma)}: ${dinheiro(p.valor)}`).join(" &nbsp;·&nbsp; ");

  const info = [];
  if (v.clienteFiadoNome) info.push(["Cliente (fiado)", escHtml(v.clienteFiadoNome)]);
  if (v.cpfCnpj)          info.push(["CPF/CNPJ", escHtml(v.cpfCnpj)]);
  if (v.observacoes)      info.push(["Observação", escHtml(v.observacoes)]);
  info.push(["Operador", escHtml(v.operador || "—")]);
  info.push(["Pagamento", pagamentos]);
  if (v.cancelada) info.push(["Status", badge("Cancelada", "#FEE2E2", "#991B1B")]);

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--space-5);align-items:start">
      <div>${itens}</div>
      <div style="font-size:var(--text-sm);display:flex;flex-direction:column;gap:6px">
        ${info.map(([k, val]) => linhaResumo(k, val)).join("")}
        <div style="height:6px"></div>
        ${linhaResumo("Subtotal", dinheiro(c.subtotal))}
        ${linhaResumo("Desconto nos itens", `− ${dinheiro(c.descItens)}`, false, c.descItens > 0 ? "#DC2626" : "")}
        ${linhaResumo("Desconto total", `− ${dinheiro(c.descTotal)}`, false, c.descTotal > 0 ? "#DC2626" : "")}
        ${linhaResumo("Acréscimo", `+ ${dinheiro(c.acrescimo)}`, false, c.acrescimo > 0 ? "#059669" : "")}
        ${linhaResumo("Total", dinheiro(v.total), true)}
      </div>
    </div>`;
}

// ── Exportar Excel (uma linha por item vendido) ──────────────
function exportar() {
  if (!_vendas.length) { window.mostrarToast("Nenhuma venda neste dia para exportar.", "error"); return; }
  const iso = $("vendDia").value || isoLocal(new Date());
  const linhas = [["Venda", "Data", "Hora", "Operador", "Pagamento", "Cliente", "Status",
                   "Produto", "Qtd", "Unitário", "Desconto item", "Total item", "Total da venda"]];
  _vendas.forEach(v => {
    const base = [
      v.numero ?? "", isNaN(v.dt) ? "" : v.dt.toLocaleDateString("pt-BR"), isNaN(v.dt) ? "" : horaStr(v.dt),
      v.operador || "", v.formaPagamento || "", v.clienteFiadoNome || "", v.cancelada ? "Cancelada" : "Concluída"
    ];
    if (!v.lista.length) { linhas.push([...base, "", "", "", "", "", num(v.total)]); return; }
    v.lista.forEach(i => linhas.push([...base, i.nome || "", num(i.qtd), num(i.precoUnit), num(i.desconto), num(i.total), num(v.total)]));
  });
  if (exportarExcel(`vendas_${iso}.xlsx`, linhas)) window.mostrarToast("Vendas exportadas!", "success");
}

// ── Abas (Terminal PDV | Histórico de Vendas) ────────────────
function mostrarAba(aba) {
  _abaAtual = aba;
  if ($("caixaPainelPDV"))    $("caixaPainelPDV").hidden    = aba !== "pdv";
  if ($("caixaPainelVendas")) $("caixaPainelVendas").hidden = aba !== "vendas";
  document.querySelectorAll("#caixaTabs [data-caixa-tab]").forEach(b => {
    b.classList.toggle("prom-tab--active", b.dataset.caixaTab === aba);
  });
  if (aba === "vendas") {
    const dia = $("vendDia");
    dia.max = isoLocal(new Date());
    if (!dia.value) dia.value = dia.max;
    carregarDia();
  } else {
    $("terminalInput")?.focus();
  }
}

function mudarDia(delta) {
  const dia = $("vendDia");
  const hoje = isoLocal(new Date());
  const novo = somarDias(dia.value || hoje, delta);
  if (novo > hoje) return; // não existe venda no futuro
  dia.value = novo;
  carregarDia();
}

// ── Inicialização ────────────────────────────────────────────
export function iniciarVendas(usuario, dadosUsuario) {
  _admin = dadosUsuario?.role === "admin";
  const tabs = $("caixaTabs");
  if (!tabs) return;

  // Funcionário: sem aba de histórico (o resumo financeiro é restrito ao admin)
  tabs.hidden = !_admin;
  if (!_admin) {
    delete window.abrirHistoricoVendas;
    if (_abaAtual !== "pdv") mostrarAba("pdv");
    return;
  }
  window.abrirHistoricoVendas = () => mostrarAba("vendas");

  if (_ligado) return;
  _ligado = true;

  tabs.querySelectorAll("[data-caixa-tab]").forEach(b => {
    b.addEventListener("click", () => mostrarAba(b.dataset.caixaTab));
  });

  const dia = $("vendDia");
  dia.value = isoLocal(new Date());
  dia.max = dia.value;
  dia.addEventListener("change", () => { if (dia.value) carregarDia(); });

  $("vendDiaAnt").addEventListener("click", () => mudarDia(-1));
  $("vendDiaProx").addEventListener("click", () => mudarDia(1));
  $("vendHoje").addEventListener("click", () => { dia.value = isoLocal(new Date()); carregarDia(); });
  $("vendFiltroForma").addEventListener("change", renderizar);
  $("vendBusca").addEventListener("input", renderizar);
  $("vendExportar").addEventListener("click", exportar);

  // Abrir/fechar o detalhe de cada venda (delegação: a lista é redesenhada a cada filtro)
  $("vendConteudo").addEventListener("click", (e) => {
    const row = e.target.closest(".vend-row");
    if (!row) return;
    const det = row.parentElement.querySelector(`.vend-det[data-det="${CSS.escape(row.dataset.vid)}"]`);
    if (!det) return;
    const abrir = det.style.display === "none";
    det.style.display = abrir ? "table-row" : "none";
    const seta = row.querySelector(".vend-seta");
    if (seta) seta.textContent = abrir ? "▾" : "▸";
  });

  // Ao voltar para a página Caixa com a aba de vendas aberta, atualiza os números
  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "caixa" && _admin && _abaAtual === "vendas") carregarDia();
  });
}
