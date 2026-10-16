// promissoria.js — Módulo Promissórias (somente admin) — Gerência Viviane Vargas Stories
import {
  collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, escHtml, exportarExcel } from "../utils/database.js";

const COL_CLIENTES   = "prom_clientes";
const COL_COMPRAS    = "prom_compras";
const COL_PAGAMENTOS = "prom_pagamentos";
const JUROS_MENSAL   = 0.02;

let _dadosUsuario = null;

// ── Inicialização ────────────────────────────────────────────
export function iniciarPromissoria(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "promissoria") {
      if (_dadosUsuario?.role !== "admin") {
        window.navegar?.("dashboard");
        window.mostrarToast?.("Acesso restrito a administradores.", "error");
        return;
      }
      carregarPromissoriaPage();
    }
  });

  document.getElementById("btnNovoClienteProm")?.addEventListener("click", abrirModalNovoCliente);
  document.getElementById("tabPromClientes")?.addEventListener("click",  () => trocarAba("clientes"));
  document.getElementById("tabPromDashboard")?.addEventListener("click", () => trocarAba("dashboard"));
  document.getElementById("btnAtualizarDashProm")?.addEventListener("click", carregarDashboard);

  document.getElementById("btnBuscarProm")?.addEventListener("click", () => {
    carregarListaClientes(
      document.getElementById("filtroBuscaProm").value.trim(),
      document.getElementById("filtroStatusProm").value
    );
  });
  document.getElementById("btnLimparBuscaProm")?.addEventListener("click", () => {
    document.getElementById("filtroBuscaProm").value = "";
    document.getElementById("filtroStatusProm").value = "todos";
    carregarListaClientes();
  });
  document.getElementById("filtroBuscaProm")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      carregarListaClientes(e.target.value.trim(), document.getElementById("filtroStatusProm").value);
    }
  });

  document.getElementById("btnVoltarListaProm")?.addEventListener("click", () => {
    mostrarPainel("lista");
    carregarListaClientes();
  });

  document.getElementById("tbodyClientesProm")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "ver-cliente")    abrirPainelCliente(btn.dataset.id);
    if (btn.dataset.action === "excluir-cliente") confirmarExcluirCliente(btn.dataset.id);
  });

  document.getElementById("painelDetalhesClienteProm")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const clienteId = btn.dataset.clienteId
      || btn.closest("[data-cliente-id]")?.dataset.clienteId
      || document.getElementById("painelDetalhesClienteProm")?.dataset.clienteId;
    if (btn.dataset.action === "nova-compra")      abrirModalNovaCompra(clienteId);
    if (btn.dataset.action === "novo-pagamento")   abrirModalNovoPagamento(clienteId);
    if (btn.dataset.action === "excluir-compra")   confirmarExcluirCompra(btn.dataset.id);
    if (btn.dataset.action === "imprimir-cliente") imprimirCliente(clienteId);
  });

  document.getElementById("btnExportarProm")?.addEventListener("click", exportarRelatorio);
  document.getElementById("btnImprimirProm")?.addEventListener("click", imprimirRelatorio);
  document.getElementById("btnImportarCsvProm")?.addEventListener("click", () => {
    document.getElementById("inputImportarCsvProm").click();
  });
  document.getElementById("inputImportarCsvProm")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importarCSV(file);
    e.target.value = "";
  });
}

// ── Painéis internos ─────────────────────────────────────────
function mostrarPainel(painel) {
  document.getElementById("painelListaClientesProm").hidden   = painel !== "lista";
  document.getElementById("painelDetalhesClienteProm").hidden = painel !== "detalhes";
  document.getElementById("painelDashboardProm").hidden       = painel !== "dashboard";
}

function trocarAba(aba) {
  const tabC = document.getElementById("tabPromClientes");
  const tabD = document.getElementById("tabPromDashboard");
  tabC.classList.toggle("prom-tab--active", aba === "clientes");
  tabD.classList.toggle("prom-tab--active", aba === "dashboard");
  tabC.setAttribute("aria-selected", aba === "clientes");
  tabD.setAttribute("aria-selected", aba === "dashboard");
  if (aba === "dashboard") { mostrarPainel("dashboard"); carregarDashboard(); }
  else { mostrarPainel("lista"); carregarListaClientes(); }
}

async function carregarPromissoriaPage() {
  mostrarPainel("lista");
  await Promise.all([carregarIndicadores(), carregarListaClientes()]);
}

// ── Indicadores ──────────────────────────────────────────────
async function carregarIndicadores() {
  const el = id => document.getElementById(id);
  ["indTotalVendido","indTotalRecebido","indTotalAberto","indInadimplentes","indClientesTotal"].forEach(i => {
    const e = el(i); if (e) e.textContent = "—";
  });
  try {
    const [clientes, compras, pagamentos] = await Promise.all([
      getDocs(collection(db, COL_CLIENTES)),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_PAGAMENTOS))
    ]);
    const hoje = new Date();
    let totalVendido = 0, totalRecebido = 0, inadimplentes = 0;
    const saldoMap = {};

    compras.forEach(d => {
      const c = d.data();
      totalVendido += c.valor || 0;
      if (!saldoMap[c.clienteId]) saldoMap[c.clienteId] = { compras: 0, pagamentos: 0, vencido: false };
      saldoMap[c.clienteId].compras += c.valor || 0;
      if (c.vencimento) {
        const v = c.vencimento.toDate?.() || new Date(c.vencimento);
        if (v < hoje) saldoMap[c.clienteId].vencido = true;
      }
    });
    pagamentos.forEach(d => {
      const p = d.data();
      totalRecebido += p.valor || 0;
      if (!saldoMap[p.clienteId]) saldoMap[p.clienteId] = { compras: 0, pagamentos: 0, vencido: false };
      saldoMap[p.clienteId].pagamentos += p.valor || 0;
    });
    Object.values(saldoMap).forEach(s => {
      if (s.compras - s.pagamentos > 0 && s.vencido) inadimplentes++;
    });

    if (el("indTotalVendido"))   el("indTotalVendido").textContent   = formatarMoeda(totalVendido);
    if (el("indTotalRecebido"))  el("indTotalRecebido").textContent  = formatarMoeda(totalRecebido);
    if (el("indTotalAberto"))    el("indTotalAberto").textContent    = formatarMoeda(Math.max(0, totalVendido - totalRecebido));
    if (el("indInadimplentes"))  el("indInadimplentes").textContent  = inadimplentes;
    if (el("indClientesTotal"))  el("indClientesTotal").textContent  = clientes.size;
  } catch (err) { console.error(err); }
}

// ── Lista de Clientes ────────────────────────────────────────
async function carregarListaClientes(busca = "", status = "todos") {
  const tbody = document.getElementById("tbodyClientesProm");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Carregando...</td></tr>`;
  try {
    const [clientesSnap, comprasSnap, pagamentosSnap] = await Promise.all([
      getDocs(query(collection(db, COL_CLIENTES), orderBy("nome"))),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_PAGAMENTOS))
    ]);
    const hoje = new Date();
    const comprasPorCli = {}, pagosPorCli = {}, vencidoPorCli = {}, qtdCompraPorCli = {};

    comprasSnap.forEach(d => {
      const c = d.data();
      comprasPorCli[c.clienteId]  = (comprasPorCli[c.clienteId]  || 0) + (c.valor || 0);
      qtdCompraPorCli[c.clienteId] = (qtdCompraPorCli[c.clienteId] || 0) + 1;
      if (c.vencimento) {
        const v = c.vencimento.toDate?.() || new Date(c.vencimento);
        if (v < hoje) vencidoPorCli[c.clienteId] = true;
      }
    });
    pagamentosSnap.forEach(d => {
      const p = d.data();
      pagosPorCli[p.clienteId] = (pagosPorCli[p.clienteId] || 0) + (p.valor || 0);
    });

    let clientes = [];
    clientesSnap.forEach(d => {
      const c = { id: d.id, ...d.data() };
      c.totalComprado = comprasPorCli[c.id] || 0;
      c.totalPago     = pagosPorCli[c.id]   || 0;
      c.saldo         = Math.max(0, c.totalComprado - c.totalPago);
      c.qtdCompras    = qtdCompraPorCli[c.id] || 0;
      if (c.saldo <= 0) c.situacao = "Quitado";
      else if (vencidoPorCli[c.id]) c.situacao = "Atrasado";
      else c.situacao = "Pendente";
      clientes.push(c);
    });

    if (busca) {
      const t = busca.toLowerCase();
      clientes = clientes.filter(c => c.nome?.toLowerCase().includes(t) || c.telefone?.includes(t));
    }
    if (status !== "todos") clientes = clientes.filter(c => c.situacao === status);

    if (!clientes.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhum cliente encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = clientes.map(c => `
      <tr>
        <td>
          <div style="font-weight:600;color:var(--gray-800)">${escHtml(c.nome)}</div>
          ${c.telefone ? `<div style="font-size:var(--text-xs);color:var(--gray-400)">${escHtml(c.telefone)}</div>` : ""}
        </td>
        <td style="text-align:center;color:var(--gray-500)">${c.qtdCompras}</td>
        <td>${formatarMoeda(c.totalComprado)}</td>
        <td style="color:var(--color-success)">${formatarMoeda(c.totalPago)}</td>
        <td><strong style="color:${c.saldo > 0 ? "var(--color-danger)" : "var(--color-success)"}">${formatarMoeda(c.saldo)}</strong></td>
        <td>${badgeSituacao(c.situacao)}</td>
        <td class="col-center" style="white-space:nowrap">
          <button class="btn-table-action btn-table-action--view" data-action="ver-cliente" data-id="${c.id}" title="Ver detalhes">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--delete" data-action="excluir-cliente" data-id="${c.id}" title="Excluir">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </td>
      </tr>`).join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Erro ao carregar.</td></tr>`;
  }
}

// ── Painel Detalhes do Cliente ────────────────────────────────
async function abrirPainelCliente(clienteId) {
  if (!clienteId) return;
  mostrarPainel("detalhes");
  const painel = document.getElementById("painelDetalhesClienteProm");
  if (!painel) return;
  painel.dataset.clienteId = clienteId;
  painel.innerHTML = `<div class="loading-cell" style="padding:40px 0">Carregando dados do cliente...</div>`;

  try {
    const [clienteSnap, comprasSnap, pagamentosSnap] = await Promise.all([
      getDoc(doc(db, COL_CLIENTES, clienteId)),
      getDocs(query(collection(db, COL_COMPRAS), where("clienteId","==",clienteId), orderBy("dataCompra","desc"))),
      getDocs(query(collection(db, COL_PAGAMENTOS), where("clienteId","==",clienteId), orderBy("dataPagamento","desc")))
    ]);

    if (!clienteSnap.exists()) { painel.innerHTML = `<p class="empty-cell">Cliente não encontrado.</p>`; return; }
    const cliente = clienteSnap.data();
    const hoje = new Date();

    const pagoPorCompra = {};
    const pagamentos = [];
    pagamentosSnap.forEach(d => {
      const p = { id: d.id, ...d.data() };
      pagamentos.push(p);
      if (p.compraId) pagoPorCompra[p.compraId] = (pagoPorCompra[p.compraId] || 0) + (p.valor || 0);
    });

    let totalComprado = 0, totalPago = 0, totalJuros = 0;
    const compras = [];
    comprasSnap.forEach(d => {
      const c = { id: d.id, ...d.data() };
      const venc = c.vencimento ? (c.vencimento.toDate?.() || new Date(c.vencimento)) : null;
      const mesesAtraso = venc && venc < hoje
        ? Math.floor((hoje - venc) / (1000 * 60 * 60 * 24 * 30))
        : 0;
      c.juros = mesesAtraso > 0 ? (c.valor || 0) * JUROS_MENSAL * mesesAtraso : 0;
      c.valorComJuros = (c.valor || 0) + c.juros;
      c.mesesAtraso = mesesAtraso;
      c.pagoCompra = pagoPorCompra[c.id] || 0;
      c.saldoCompra = Math.max(0, (c.valor || 0) - c.pagoCompra);
      totalComprado += c.valor || 0;
      totalJuros += c.juros;
      compras.push(c);
    });
    pagamentos.forEach(p => totalPago += p.valor || 0);
    const saldo = totalComprado - totalPago;
    const saldoComJuros = Math.max(0, saldo) + totalJuros;

    let situacao;
    if (saldo <= 0) situacao = "Quitado";
    else if (compras.some(c => c.mesesAtraso > 0)) situacao = "Atrasado";
    else situacao = "Pendente";

    painel.innerHTML = `
      <div data-cliente-id="${clienteId}">
        <!-- Cabeçalho -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:var(--space-6);flex-wrap:wrap">
          <button class="btn-ghost" id="btnVoltarListaProm" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd"/></svg>
            Voltar
          </button>
          <div>
            <h2 style="font-size:var(--text-xl);font-weight:700;color:var(--gray-900);margin:0">${escHtml(cliente.nome)}</h2>
            ${cliente.telefone ? `<span style="font-size:var(--text-sm);color:var(--gray-400)">${escHtml(cliente.telefone)}</span>` : ""}
          </div>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-ghost" data-action="imprimir-cliente" data-cliente-id="${clienteId}" style="display:inline-flex;align-items:center;gap:6px">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v4H6v-4zm7-4a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"/></svg>
              Imprimir
            </button>
            <button class="btn-ghost" data-action="nova-compra" data-cliente-id="${clienteId}" style="display:inline-flex;align-items:center;gap:6px">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>
              Nova Compra
            </button>
            <button class="btn-primary" data-action="novo-pagamento" data-cliente-id="${clienteId}" style="display:inline-flex;align-items:center;gap:6px">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/></svg>
              Registrar Pagamento
            </button>
          </div>
        </div>

        <!-- Cards de resumo -->
        <div class="stats-grid" style="margin-bottom:var(--space-6)">
          <div class="stat-card stat-card--blue">
            <div class="stat-card__icon"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4z" clip-rule="evenodd"/></svg></div>
            <div class="stat-card__body"><span class="stat-card__label">Total Comprado</span><strong class="stat-card__value stat-card__value--sm">${formatarMoeda(totalComprado)}</strong></div>
          </div>
          <div class="stat-card stat-card--green">
            <div class="stat-card__icon"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/></svg></div>
            <div class="stat-card__body"><span class="stat-card__label">Total Pago</span><strong class="stat-card__value stat-card__value--sm">${formatarMoeda(totalPago)}</strong></div>
          </div>
          <div class="stat-card ${saldo > 0 ? "stat-card--gold" : "stat-card--green"}">
            <div class="stat-card__icon"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg></div>
            <div class="stat-card__body"><span class="stat-card__label">Saldo Devedor</span><strong class="stat-card__value stat-card__value--sm">${formatarMoeda(Math.max(0, saldo))}</strong></div>
          </div>
          ${totalJuros > 0 ? `
          <div class="stat-card" style="border-color:#FECACA">
            <div class="stat-card__icon" style="background:#FEE2E2;color:#DC2626"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></div>
            <div class="stat-card__body"><span class="stat-card__label">Juros Acumulados</span><strong class="stat-card__value stat-card__value--sm" style="color:#DC2626">${formatarMoeda(totalJuros)}</strong></div>
          </div>
          <div class="stat-card" style="border-color:#FECACA">
            <div class="stat-card__icon" style="background:#FEE2E2;color:#DC2626"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clip-rule="evenodd"/></svg></div>
            <div class="stat-card__body"><span class="stat-card__label">Total c/ Juros</span><strong class="stat-card__value stat-card__value--sm" style="color:#DC2626">${formatarMoeda(saldoComJuros)}</strong></div>
          </div>` : ""}
        </div>

        <!-- Situação -->
        <div style="margin-bottom:var(--space-6);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:var(--text-sm);color:var(--gray-500);font-weight:500">Situação atual:</span>
          ${badgeSituacao(situacao)}
          ${totalJuros > 0 ? `<span style="font-size:var(--text-xs);color:#DC2626;font-weight:500">· Juros de 2% a.m. em ${compras.filter(c=>c.mesesAtraso>0).length} compra(s) em atraso</span>` : ""}
        </div>

        <!-- Histórico de Compras -->
        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card-header">
            <h3 class="card-section-title" style="margin:0">Histórico de Compras</h3>
            <span style="font-size:var(--text-sm);color:var(--gray-500)">${compras.length} compra(s)</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr>
                <th>Data</th><th>Valor</th><th>Vencimento</th><th>Juros</th>
                <th>Total c/ Juros</th><th>Pago</th><th>Saldo</th><th>Status</th><th>Obs.</th>
                <th class="col-center">Ações</th>
              </tr></thead>
              <tbody>${compras.length === 0
                ? `<tr><td colspan="10" class="empty-cell">Nenhuma compra registrada.</td></tr>`
                : compras.map(c => {
                  const venc = c.vencimento ? (c.vencimento.toDate?.() || new Date(c.vencimento)) : null;
                  return `<tr>
                    <td>${formatarDataLocal(c.dataCompra)}</td>
                    <td>${formatarMoeda(c.valor)}</td>
                    <td>${venc ? formatarDataLocal(c.vencimento) : "—"}</td>
                    <td>${c.juros > 0 ? `<span style="color:#DC2626">${formatarMoeda(c.juros)}</span>` : "—"}</td>
                    <td>${c.juros > 0 ? `<strong style="color:#DC2626">${formatarMoeda(c.valorComJuros)}</strong>` : formatarMoeda(c.valor)}</td>
                    <td>${c.pagoCompra > 0 ? `<span style="color:var(--color-success)">${formatarMoeda(c.pagoCompra)}</span>` : "—"}</td>
                    <td>${c.saldoCompra > 0 ? `<strong style="color:var(--color-danger)">${formatarMoeda(c.saldoCompra)}</strong>` : `<span style="color:var(--color-success)">Quitado</span>`}</td>
                    <td>${c.juros > 0 ? badgeSituacao("Atrasado") : (venc ? badgeSituacao("Pendente") : "—")}</td>
                    <td style="max-width:140px;white-space:normal;font-size:var(--text-xs);color:var(--gray-500)">${escHtml(c.observacoes||"")}</td>
                    <td class="col-center">
                      <button class="btn-table-action btn-table-action--delete" data-action="excluir-compra" data-id="${c.id}" title="Excluir compra">
                        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                      </button>
                    </td>
                  </tr>`;
                }).join("")}</tbody>
            </table>
          </div>
        </div>

        <!-- Histórico de Pagamentos -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-section-title" style="margin:0">Histórico de Pagamentos</h3>
            <span style="font-size:var(--text-sm);color:var(--gray-500)">${pagamentos.length} pagamento(s)</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Data</th><th>Valor Pago</th><th>Compra Relacionada</th><th>Forma</th><th>Obs.</th></tr></thead>
              <tbody>${pagamentos.length === 0
                ? `<tr><td colspan="5" class="empty-cell">Nenhum pagamento registrado.</td></tr>`
                : pagamentos.map(p => {
                  const rel = p.compraId ? compras.find(c => c.id === p.compraId) : null;
                  return `<tr>
                    <td>${formatarDataLocal(p.dataPagamento)}</td>
                    <td><strong style="color:var(--color-success)">${formatarMoeda(p.valor)}</strong></td>
                    <td style="font-size:var(--text-xs);color:var(--gray-500)">${rel ? `Compra de ${formatarDataLocal(rel.dataCompra)}` : "Crédito geral"}</td>
                    <td>${escHtml(p.forma||"—")}</td>
                    <td style="font-size:var(--text-xs);color:var(--gray-500)">${escHtml(p.observacoes||"")}</td>
                  </tr>`;
                }).join("")}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    // Rebind botão voltar (gerado dinamicamente)
    document.getElementById("btnVoltarListaProm")?.addEventListener("click", () => {
      mostrarPainel("lista");
      carregarListaClientes();
    });
  } catch (err) {
    console.error(err);
    painel.innerHTML = `<div class="empty-cell">Erro ao carregar dados do cliente.</div>`;
  }
}

// ── Modais ────────────────────────────────────────────────────
function abrirModalNovoCliente() {
  const body = `
    <div class="form-usuario">
      <div><label class="field-label">Nome completo *</label>
        <input type="text" id="mPromNome" class="field-input--plain" placeholder="Nome do cliente" autocomplete="off" /></div>
      <div><label class="field-label">Telefone / WhatsApp</label>
        <input type="tel" id="mPromTelefone" class="field-input--plain" placeholder="(00) 00000-0000" /></div>
      <div><label class="field-label">Observações</label>
        <input type="text" id="mPromObs" class="field-input--plain" placeholder="Informações adicionais..." /></div>
    </div>`;
  window.abrirModal("Novo Cliente", body,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-primary" id="btnSalvarNovoCli">Salvar Cliente</button>`);
  document.getElementById("btnCancProm").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarNovoCli").onclick = salvarNovoCliente;
  document.getElementById("mPromNome").focus();
}

async function salvarNovoCliente() {
  const nome = document.getElementById("mPromNome").value.trim();
  if (!nome) { window.mostrarToast("Informe o nome do cliente.", "error"); return; }
  const btn = document.getElementById("btnSalvarNovoCli");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await addDoc(collection(db, COL_CLIENTES), {
      nome,
      telefone:    document.getElementById("mPromTelefone").value.trim(),
      observacoes: document.getElementById("mPromObs").value.trim(),
      criadoEm:    serverTimestamp()
    });
    window.fecharModal();
    window.mostrarToast("Cliente cadastrado com sucesso!", "success");
    carregarListaClientes();
    carregarIndicadores();
  } catch (err) {
    window.mostrarToast("Erro ao salvar cliente.", "error");
    btn.disabled = false; btn.textContent = "Salvar Cliente";
  }
}

let _rowSeq = 0;
function linhaCompraHtml(hojeStr, vencStr) {
  const rid = `cr${++_rowSeq}`;
  return `
    <div class="compra-row" data-row-id="${rid}">
      <div class="compra-field">
        <label class="field-label compra-field-label">Valor (R$) *</label>
        <input type="number" class="compra-valor field-input--plain" placeholder="0,00" min="0.01" step="0.01" />
      </div>
      <div class="compra-field">
        <label class="field-label compra-field-label">Data *</label>
        <input type="date" class="compra-data field-input--plain" value="${hojeStr}" />
      </div>
      <div class="compra-field">
        <label class="field-label compra-field-label">Vencimento</label>
        <input type="date" class="compra-venc field-input--plain" value="${vencStr}" />
      </div>
      <div class="compra-field compra-field--obs">
        <label class="field-label compra-field-label">Obs.</label>
        <input type="text" class="compra-obs field-input--plain" placeholder="Descrição..." />
      </div>
      <button type="button" class="btn-table-action btn-table-action--delete btn-remove-row" title="Remover">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
      </button>
    </div>`;
}

function abrirModalNovaCompra(clienteId) {
  if (!clienteId) return;
  const hoje   = new Date();
  const hojeStr = hoje.toISOString().split("T")[0];
  const vencPad = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
  const vencStr = vencPad.toISOString().split("T")[0];

  const body = `
    <div class="form-usuario">
      <div class="compra-row-labels" style="display:grid;grid-template-columns:1fr 130px 130px 1.4fr 32px;gap:8px;margin-bottom:2px">
        <label class="field-label">Valor (R$) *</label>
        <label class="field-label">Data *</label>
        <label class="field-label">Vencimento</label>
        <label class="field-label">Obs.</label><span></span>
      </div>
      <div id="comprasRowsContainer">${linhaCompraHtml(hojeStr, vencStr)}</div>
      <button type="button" class="btn-ghost" id="btnAddRow" style="font-size:var(--text-sm)">+ Adicionar outra compra</button>
      <p style="font-size:var(--text-xs);color:var(--gray-500);margin-top:8px">Linhas em branco são ignoradas ao salvar.</p>
    </div>`;

  window.abrirModal("Nova Compra", body,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-primary" id="btnSalvarCompra">Registrar Compra(s)</button>`);

  const container = document.getElementById("comprasRowsContainer");
  document.getElementById("btnAddRow").onclick = () => container.insertAdjacentHTML("beforeend", linhaCompraHtml(hojeStr, vencStr));
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-row");
    if (!btn) return;
    const rows = container.querySelectorAll(".compra-row");
    if (rows.length > 1) btn.closest(".compra-row").remove();
    else rows[0].querySelectorAll("input").forEach(i => { if (i.type !== "date") i.value = ""; });
  });
  document.getElementById("btnCancProm").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarCompra").onclick = () => salvarNovaCompra(clienteId);
  container.querySelector(".compra-valor").focus();
}

async function salvarNovaCompra(clienteId) {
  const linhas = Array.from(document.querySelectorAll("#comprasRowsContainer .compra-row"));
  const compras = [];
  for (const l of linhas) {
    const valor = parseFloat(l.querySelector(".compra-valor").value);
    const dataStr = l.querySelector(".compra-data").value;
    const vencStr = l.querySelector(".compra-venc").value;
    const obs = l.querySelector(".compra-obs").value.trim();
    if (!valor && !obs) continue;
    if (!valor || valor <= 0) { window.mostrarToast("Informe um valor válido em todas as compras.", "error"); return; }
    if (!dataStr) { window.mostrarToast("Informe a data em todas as compras.", "error"); return; }
    compras.push({ valor, dataStr, vencStr, obs });
  }
  if (!compras.length) { window.mostrarToast("Adicione ao menos uma compra.", "error"); return; }
  const btn = document.getElementById("btnSalvarCompra");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await Promise.all(compras.map(c => addDoc(collection(db, COL_COMPRAS), {
      clienteId,
      valor:       c.valor,
      dataCompra:  Timestamp.fromDate(new Date(c.dataStr + "T12:00:00")),
      vencimento:  c.vencStr ? Timestamp.fromDate(new Date(c.vencStr + "T23:59:59")) : null,
      observacoes: c.obs,
      criadoEm:    serverTimestamp()
    })));
    window.fecharModal();
    window.mostrarToast(`${compras.length} compra(s) registrada(s)!`, "success");
    abrirPainelCliente(clienteId);
    carregarIndicadores();
  } catch (err) {
    window.mostrarToast("Erro ao registrar compra(s).", "error");
    btn.disabled = false; btn.textContent = "Registrar Compra(s)";
  }
}

async function abrirModalNovoPagamento(clienteId) {
  if (!clienteId) return;
  const hojeStr = new Date().toISOString().split("T")[0];
  window.abrirModal("Registrar Pagamento",
    `<div class="form-usuario"><p class="loading-cell" style="padding:16px 0">Carregando compras em aberto...</p></div>`,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-primary" id="btnSalvarPag">Registrar Pagamento</button>`);
  document.getElementById("btnCancProm").onclick = () => window.fecharModal();

  let comprasAbertas = [];
  try {
    const [cSnap, pSnap] = await Promise.all([
      getDocs(query(collection(db, COL_COMPRAS), where("clienteId","==",clienteId), orderBy("dataCompra","asc"))),
      getDocs(query(collection(db, COL_PAGAMENTOS), where("clienteId","==",clienteId)))
    ]);
    const pagoPorCompra = {};
    pSnap.forEach(d => {
      const p = d.data();
      if (p.compraId) pagoPorCompra[p.compraId] = (pagoPorCompra[p.compraId] || 0) + (p.valor || 0);
    });
    cSnap.forEach(d => {
      const c = { id: d.id, ...d.data() };
      const saldo = Math.round(((c.valor || 0) - (pagoPorCompra[c.id] || 0)) * 100) / 100;
      if (saldo > 0.004) comprasAbertas.push({ ...c, saldo });
    });
  } catch (err) { console.error(err); }

  const listaHtml = comprasAbertas.length === 0
    ? `<p style="font-size:var(--text-sm);color:var(--gray-500);padding:8px 0">Sem compras em aberto — pagamento será lançado como crédito geral.</p>`
    : `<label class="field-label">Compras a abater</label>
       <div id="listaComprasPag" style="max-height:220px;overflow-y:auto;margin-bottom:var(--space-3)">
         ${comprasAbertas.map(c => `
           <label style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:6px">
             <input type="checkbox" class="pag-check" data-compra-id="${c.id}" data-max="${c.saldo}" checked style="width:16px;height:16px;flex:none" />
             <div style="flex:1;min-width:0">
               <div style="font-size:var(--text-sm);font-weight:600;color:var(--gray-800)">Compra de ${formatarDataLocal(c.dataCompra)}${c.observacoes ? ` · ${escHtml(c.observacoes)}` : ""}</div>
               <div style="font-size:var(--text-xs);color:var(--gray-500)">Valor: ${formatarMoeda(c.valor)} · Saldo: ${formatarMoeda(c.saldo)}</div>
             </div>
             <input type="number" class="pag-valor field-input--plain" data-compra-id="${c.id}" style="width:110px;flex:none" min="0" step="0.01" max="${c.saldo}" value="${c.saldo.toFixed(2)}" />
           </label>`).join("")}
       </div>`;

  const novoBody = `
    <div class="form-usuario">
      ${listaHtml}
      <div><label class="field-label">Data do Pagamento *</label>
        <input type="date" id="mPagData" class="field-input--plain" value="${hojeStr}" /></div>
      <div><label class="field-label">Forma de Pagamento</label>
        <select id="mPagForma" class="field-input--plain">
          <option value="">Selecione...</option>
          <option>Dinheiro</option><option>PIX</option>
          <option>Cartão de Débito</option><option>Cartão de Crédito</option><option>Transferência</option>
        </select></div>
      <div><label class="field-label">Observações</label>
        <input type="text" id="mPagObs" class="field-input--plain" placeholder="Informações do pagamento..." /></div>
      ${comprasAbertas.length > 0
        ? `<div style="text-align:right;font-size:var(--text-sm);color:var(--gray-600);padding-top:4px;border-top:1px solid var(--gray-100)">Total a pagar: <strong id="mPagTotal" style="color:var(--color-success)">—</strong></div>`
        : `<div><label class="field-label">Valor (R$) *</label>
           <input type="number" id="mPagValorGeral" class="field-input--plain" placeholder="0,00" min="0.01" step="0.01" /></div>`}
    </div>`;

  const modalEl = document.getElementById("modalBody");
  if (modalEl) modalEl.innerHTML = novoBody;

  const atualizarTotal = () => {
    const el = document.getElementById("mPagTotal");
    if (!el) return;
    let total = 0;
    document.querySelectorAll(".pag-check:checked").forEach(chk => {
      const v = document.querySelector(`.pag-valor[data-compra-id="${chk.dataset.compraId}"]`);
      total += parseFloat(v?.value) || 0;
    });
    el.textContent = formatarMoeda(total);
  };
  document.querySelectorAll(".pag-check").forEach(chk => {
    chk.addEventListener("change", () => {
      const v = document.querySelector(`.pag-valor[data-compra-id="${chk.dataset.compraId}"]`);
      if (v) v.disabled = !chk.checked;
      atualizarTotal();
    });
  });
  document.querySelectorAll(".pag-valor").forEach(inp => inp.addEventListener("input", atualizarTotal));
  atualizarTotal();

  document.getElementById("btnSalvarPag").onclick = () => salvarNovoPagamento(clienteId, comprasAbertas.length > 0);
  document.getElementById("mPagData")?.focus();
}

async function salvarNovoPagamento(clienteId, temAbertos) {
  const dataStr = document.getElementById("mPagData").value;
  const forma   = document.getElementById("mPagForma").value;
  const obs     = document.getElementById("mPagObs").value.trim();
  if (!dataStr) { window.mostrarToast("Informe a data do pagamento.", "error"); return; }

  const lancamentos = [];
  if (temAbertos) {
    for (const chk of document.querySelectorAll(".pag-check:checked")) {
      const compraId = chk.dataset.compraId;
      const max = parseFloat(chk.dataset.max) || 0;
      const vi  = document.querySelector(`.pag-valor[data-compra-id="${compraId}"]`);
      const valor = parseFloat(vi?.value);
      if (!valor || valor <= 0) continue;
      if (valor > max + 0.01) { window.mostrarToast("Valor maior que o saldo da compra.", "error"); return; }
      lancamentos.push({ compraId, valor });
    }
    if (!lancamentos.length) { window.mostrarToast("Selecione ao menos uma compra para abater.", "error"); return; }
  } else {
    const valor = parseFloat(document.getElementById("mPagValorGeral")?.value);
    if (!valor || valor <= 0) { window.mostrarToast("Informe um valor válido.", "error"); return; }
    lancamentos.push({ compraId: null, valor });
  }

  const btn = document.getElementById("btnSalvarPag");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await Promise.all(lancamentos.map(l => addDoc(collection(db, COL_PAGAMENTOS), {
      clienteId,
      compraId:      l.compraId || null,
      valor:         l.valor,
      dataPagamento: Timestamp.fromDate(new Date(dataStr + "T12:00:00")),
      forma, observacoes: obs,
      criadoEm:      serverTimestamp()
    })));
    window.fecharModal();
    window.mostrarToast("Pagamento registrado!", "success");
    abrirPainelCliente(clienteId);
    carregarIndicadores();
  } catch (err) {
    window.mostrarToast("Erro ao registrar pagamento.", "error");
    btn.disabled = false; btn.textContent = "Registrar Pagamento";
  }
}

// ── Exclusões ─────────────────────────────────────────────────
function confirmarExcluirCliente(id) {
  window.abrirModal("Excluir Cliente",
    `<div class="delete-warning"><strong>⚠️ Atenção: ação irreversível!</strong>Remove o cliente e todo o histórico de compras e pagamentos.</div>`,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-danger" id="btnConfExcCli">Excluir Permanentemente</button>`);
  document.getElementById("btnCancProm").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcCli").onclick = () => excluirCliente(id);
}

async function excluirCliente(id) {
  const btn = document.getElementById("btnConfExcCli");
  btn.disabled = true; btn.textContent = "Excluindo...";
  try {
    await deleteDoc(doc(db, COL_CLIENTES, id));
    const [c, p] = await Promise.all([
      getDocs(query(collection(db, COL_COMPRAS),    where("clienteId","==",id))),
      getDocs(query(collection(db, COL_PAGAMENTOS), where("clienteId","==",id)))
    ]);
    await Promise.all([...c.docs.map(d => deleteDoc(d.ref)), ...p.docs.map(d => deleteDoc(d.ref))]);
    window.fecharModal();
    window.mostrarToast("Cliente excluído.", "success");
    mostrarPainel("lista");
    carregarListaClientes();
    carregarIndicadores();
  } catch (err) {
    window.mostrarToast("Erro ao excluir.", "error");
    btn.disabled = false; btn.textContent = "Excluir Permanentemente";
  }
}

function confirmarExcluirCompra(id) {
  window.abrirModal("Excluir Compra",
    `<div class="delete-warning"><strong>⚠️ Confirmar exclusão</strong>Esta compra será removida permanentemente.</div>`,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-danger" id="btnConfExcComp">Excluir Compra</button>`);
  document.getElementById("btnCancProm").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcComp").onclick = () => excluirCompra(id);
}

async function excluirCompra(id) {
  const btn = document.getElementById("btnConfExcComp");
  btn.disabled = true; btn.textContent = "Excluindo...";
  try {
    const snap = await getDoc(doc(db, COL_COMPRAS, id));
    const clienteId = snap.data()?.clienteId;
    await deleteDoc(doc(db, COL_COMPRAS, id));
    window.fecharModal();
    window.mostrarToast("Compra excluída.", "success");
    if (clienteId) abrirPainelCliente(clienteId);
    carregarIndicadores();
  } catch (err) {
    window.mostrarToast("Erro ao excluir.", "error");
    btn.disabled = false; btn.textContent = "Excluir Compra";
  }
}

// ── Dashboard ────────────────────────────────────────────────
const CORES = { azul:"#B79061", verde:"#10B981", amarelo:"#F2C80F", vermelho:"#E54957", roxo:"#7C3AED", laranja:"#FD625E", cinza:"#94A3B8" };
const _charts = {};

function _destroyChart(k) { if (_charts[k]) { _charts[k].destroy(); delete _charts[k]; } }

function _ultimosMeses(n) {
  const res = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    res.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}) });
  }
  return res;
}

function _somaPorMes(items, campo, mes) {
  return items.filter(i => {
    const d = i[campo]?.toDate?.() || (i[campo] ? new Date(i[campo]) : null);
    return d && d.getFullYear() === mes.year && d.getMonth() === mes.month;
  }).reduce((s, i) => s + (i.valor || 0), 0);
}

function _opcoesBase(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
    ...extra
  };
}

async function carregarDashboard() {
  if (typeof Chart === "undefined") return;
  const el = id => document.getElementById(id);
  ["dashIndVendido","dashIndRecebido","dashIndAberto","dashIndTicket","dashIndInadimplencia"].forEach(i => {
    const e = el(i); if (e) e.textContent = "—";
  });

  try {
    const [cliSnap, compSnap, pagSnap] = await Promise.all([
      getDocs(collection(db, COL_CLIENTES)),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_PAGAMENTOS))
    ]);
    const hoje = new Date();
    const compras = [], pagamentos = [], clientes = [];
    compSnap.forEach(d => compras.push({ id: d.id, ...d.data() }));
    pagSnap.forEach(d => pagamentos.push({ id: d.id, ...d.data() }));
    cliSnap.forEach(d => clientes.push({ id: d.id, ...d.data() }));

    const totalVendido  = compras.reduce((s,c)=>s+(c.valor||0),0);
    const totalRecebido = pagamentos.reduce((s,p)=>s+(p.valor||0),0);
    const totalAberto   = Math.max(0, totalVendido - totalRecebido);
    const ticketMedio   = compras.length ? totalVendido / compras.length : 0;

    const saldoMap = {};
    compras.forEach(c => {
      if (!saldoMap[c.clienteId]) saldoMap[c.clienteId] = { compras:0, pagamentos:0, vencido:false };
      saldoMap[c.clienteId].compras += c.valor || 0;
      if (c.vencimento) { const v = c.vencimento.toDate?.() || new Date(c.vencimento); if (v<hoje) saldoMap[c.clienteId].vencido=true; }
    });
    pagamentos.forEach(p => {
      if (!saldoMap[p.clienteId]) saldoMap[p.clienteId] = { compras:0, pagamentos:0, vencido:false };
      saldoMap[p.clienteId].pagamentos += p.valor || 0;
    });

    let quitados=0, pendentes=0, atrasados=0;
    clientes.forEach(c => {
      const s = saldoMap[c.id] || {};
      const saldo = (s.compras||0)-(s.pagamentos||0);
      if (saldo<=0) quitados++;
      else if (s.vencido) atrasados++;
      else pendentes++;
    });
    const inadimplencia = clientes.length ? (atrasados/clientes.length)*100 : 0;

    if (el("dashIndVendido"))       el("dashIndVendido").textContent      = formatarMoeda(totalVendido);
    if (el("dashIndRecebido"))      el("dashIndRecebido").textContent     = formatarMoeda(totalRecebido);
    if (el("dashIndAberto"))        el("dashIndAberto").textContent       = formatarMoeda(totalAberto);
    if (el("dashIndTicket"))        el("dashIndTicket").textContent       = formatarMoeda(ticketMedio);
    if (el("dashIndInadimplencia")) el("dashIndInadimplencia").textContent = inadimplencia.toFixed(1)+"%";

    // Gráfico 1: Vendas x Recebimentos (6 meses)
    const meses6 = _ultimosMeses(6);
    _destroyChart("chartEvolucao");
    _charts.chartEvolucao = new Chart(el("chartEvolucao"), {
      type: "bar",
      data: { labels: meses6.map(m=>m.label), datasets: [
        { label:"Vendido",  data: meses6.map(m=>_somaPorMes(compras,"dataCompra",m)),    backgroundColor: CORES.azul,  borderRadius:4 },
        { label:"Recebido", data: meses6.map(m=>_somaPorMes(pagamentos,"dataPagamento",m)), backgroundColor: CORES.verde, borderRadius:4 }
      ]},
      options: _opcoesBase({ scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>formatarMoeda(v) } } } })
    });

    // Gráfico 2: Situação clientes (donut)
    _destroyChart("chartSituacao");
    _charts.chartSituacao = new Chart(el("chartSituacao"), {
      type: "doughnut",
      data: { labels:["Quitado","Pendente","Atrasado"], datasets:[{
        data:[quitados,pendentes,atrasados], backgroundColor:[CORES.verde,CORES.amarelo,CORES.vermelho], borderWidth:0
      }]},
      options: _opcoesBase({ cutout:"65%", scales:undefined })
    });

    // Gráfico 3: Formas de pagamento (pizza)
    const porForma = {};
    pagamentos.forEach(p => { const f=p.forma||"Não informado"; porForma[f]=(porForma[f]||0)+(p.valor||0); });
    _destroyChart("chartForma");
    _charts.chartForma = new Chart(el("chartForma"), {
      type: "pie",
      data: { labels: Object.keys(porForma).length ? Object.keys(porForma) : ["Sem dados"],
        datasets:[{ data: Object.values(porForma).length ? Object.values(porForma) : [1],
          backgroundColor:[CORES.azul,CORES.verde,CORES.amarelo,CORES.roxo,CORES.laranja,CORES.cinza], borderWidth:0 }]},
      options: _opcoesBase({ scales:undefined })
    });

    // Gráfico 4: Top 10 devedores (barras horizontais)
    const devedores = clientes
      .map(c => ({ nome: c.nome, saldo: Math.max(0, (saldoMap[c.id]?.compras||0)-(saldoMap[c.id]?.pagamentos||0)) }))
      .filter(c => c.saldo > 0)
      .sort((a,b) => b.saldo - a.saldo)
      .slice(0, 10);
    _destroyChart("chartTop10");
    _charts.chartTop10 = new Chart(el("chartTop10"), {
      type: "bar",
      data: { labels: devedores.map(c=>c.nome), datasets:[{
        label:"Saldo Devedor", data:devedores.map(c=>c.saldo), backgroundColor:CORES.vermelho, borderRadius:4
      }]},
      options: { ...(_opcoesBase({})), indexAxis:"y", scales:{ x:{ beginAtZero:true, ticks:{ callback:v=>formatarMoeda(v) } } } }
    });

    // Gráfico 5: Novas compras por mês (12 meses, linha)
    const meses12 = _ultimosMeses(12);
    _destroyChart("chartLinha");
    _charts.chartLinha = new Chart(el("chartLinha"), {
      type: "line",
      data: { labels: meses12.map(m=>m.label), datasets:[{
        label:"Novas compras", data: meses12.map(m => compras.filter(c=>{
          const d=c.dataCompra?.toDate?.() || (c.dataCompra ? new Date(c.dataCompra) : null);
          return d && d.getFullYear()===m.year && d.getMonth()===m.month;
        }).length),
        borderColor:CORES.azul, backgroundColor:CORES.azul+"33", fill:true, tension:0.4, pointRadius:4
      }]},
      options: _opcoesBase({ scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } })
    });

  } catch (err) { console.error(err); }
}

// ── Impressão / Exportação ────────────────────────────────────
async function imprimirCliente(clienteId) {
  try {
    const [cliSnap, compSnap, pagSnap] = await Promise.all([
      getDoc(doc(db, COL_CLIENTES, clienteId)),
      getDocs(query(collection(db, COL_COMPRAS), where("clienteId","==",clienteId), orderBy("dataCompra","desc"))),
      getDocs(query(collection(db, COL_PAGAMENTOS), where("clienteId","==",clienteId), orderBy("dataPagamento","desc")))
    ]);
    const cli = cliSnap.data();
    const hoje = new Date();
    let totalC=0, totalP=0;
    const compras=[], pags=[];
    compSnap.forEach(d=>{const c={id:d.id,...d.data()};totalC+=c.valor||0;compras.push(c);});
    pagSnap.forEach(d=>{const p=d.data();totalP+=p.valor||0;pags.push({id:d.id,...p});});
    const saldo = totalC - totalP;

    const win = window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Promissória — ${cli.nome}</title>
      <style>body{font-family:Arial,sans-serif;font-size:13px;margin:20px;color:#111}
      h1{font-size:18px;margin-bottom:4px}.sub{color:#555;font-size:12px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-bottom:20px}
      th{background:#715338;color:#fff;padding:7px 10px;text-align:left;font-size:12px}
      td{padding:6px 10px;border-bottom:1px solid #eee;font-size:12px}
      .resumo{display:flex;gap:20px;margin-bottom:20px;flex-wrap:wrap}
      .box{background:#f1f5f9;border-radius:8px;padding:12px 16px;min-width:130px}
      .box-label{font-size:11px;color:#555;text-transform:uppercase;margin-bottom:4px}
      .box-val{font-size:16px;font-weight:bold}@media print{body{margin:10px}}</style></head><body>
      <h1>Gerência Viviane Vargas Stories — Ficha do Cliente</h1>
      <div class="sub">${cli.nome}${cli.telefone?' · '+cli.telefone:''} · Emitido em ${hoje.toLocaleDateString('pt-BR')}</div>
      <div class="resumo">
        <div class="box"><div class="box-label">Total Comprado</div><div class="box-val">${formatarMoeda(totalC)}</div></div>
        <div class="box"><div class="box-label">Total Pago</div><div class="box-val" style="color:#059669">${formatarMoeda(totalP)}</div></div>
        <div class="box"><div class="box-label">Saldo Devedor</div><div class="box-val" style="color:${saldo>0?'#DC2626':'#059669'}">${formatarMoeda(Math.max(0,saldo))}</div></div>
      </div>
      <h3>Compras</h3>
      <table><thead><tr><th>Data</th><th>Valor</th><th>Vencimento</th><th>Observações</th></tr></thead><tbody>
        ${compras.map(c=>`<tr><td>${formatarDataLocal(c.dataCompra)}</td><td>${formatarMoeda(c.valor)}</td><td>${c.vencimento?formatarDataLocal(c.vencimento):'—'}</td><td>${c.observacoes||''}</td></tr>`).join('')}
      </tbody></table>
      <h3>Pagamentos</h3>
      <table><thead><tr><th>Data</th><th>Valor</th><th>Forma</th><th>Obs.</th></tr></thead><tbody>
        ${pags.map(p=>`<tr><td>${formatarDataLocal(p.dataPagamento)}</td><td>${formatarMoeda(p.valor)}</td><td>${p.forma||'—'}</td><td>${p.observacoes||''}</td></tr>`).join('')}
      </tbody></table>
      <script>window.onload=()=>{window.print();}<\/script></body></html>`);
    win.document.close();
  } catch(err){ window.mostrarToast("Erro ao imprimir.","error"); }
}

async function imprimirRelatorio() {
  try {
    const [cliSnap, compSnap, pagSnap] = await Promise.all([
      getDocs(query(collection(db, COL_CLIENTES), orderBy("nome"))),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_PAGAMENTOS))
    ]);
    const cMap={}, pMap={};
    compSnap.forEach(d=>{const c=d.data(); cMap[c.clienteId]=(cMap[c.clienteId]||0)+(c.valor||0);});
    pagSnap.forEach(d=>{const p=d.data(); pMap[p.clienteId]=(pMap[p.clienteId]||0)+(p.valor||0);});
    const clientes=[];
    cliSnap.forEach(d=>{const data=d.data(); clientes.push({...data,totalC:cMap[d.id]||0,totalP:pMap[d.id]||0,saldo:(cMap[d.id]||0)-(pMap[d.id]||0)});});

    const win = window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Relatório de Promissórias</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}h1{font-size:18px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#715338;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
      td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11px}
      tfoot td{font-weight:bold;background:#f1f5f9}</style></head><body>
      <h1>Gerência Viviane Vargas Stories — Relatório de Promissórias</h1>
      <p style="color:#555;font-size:11px">Emitido em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</p>
      <table><thead><tr><th>Cliente</th><th>Telefone</th><th>Total Comprado</th><th>Total Pago</th><th>Saldo Devedor</th><th>Situação</th></tr></thead>
      <tbody>${clientes.map(c=>`<tr><td>${c.nome||''}</td><td>${c.telefone||''}</td><td>${formatarMoeda(c.totalC)}</td><td>${formatarMoeda(c.totalP)}</td><td style="color:${c.saldo>0?'#DC2626':'#059669'}">${formatarMoeda(Math.max(0,c.saldo))}</td><td>${c.saldo>0?"Em aberto":"Quitado"}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">TOTAL</td><td>${formatarMoeda(clientes.reduce((a,c)=>a+c.totalC,0))}</td><td>${formatarMoeda(clientes.reduce((a,c)=>a+c.totalP,0))}</td><td>${formatarMoeda(Math.max(0,clientes.reduce((a,c)=>a+c.saldo,0)))}</td><td></td></tr></tfoot>
      </table><script>window.onload=()=>{window.print();}<\/script></body></html>`);
    win.document.close();
  } catch(err){ window.mostrarToast("Erro ao imprimir.","error"); }
}

async function exportarRelatorio() {
  try {
    const [cliSnap, compSnap, pagSnap] = await Promise.all([
      getDocs(query(collection(db, COL_CLIENTES), orderBy("nome"))),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_PAGAMENTOS))
    ]);
    const cMap={}, pMap={};
    compSnap.forEach(d=>{const c=d.data();cMap[c.clienteId]=(cMap[c.clienteId]||0)+(c.valor||0);});
    pagSnap.forEach(d=>{const p=d.data();pMap[p.clienteId]=(pMap[p.clienteId]||0)+(p.valor||0);});
    const linhas=[["Nome","Telefone","Total Comprado","Total Pago","Saldo Devedor","Situação"]];
    cliSnap.forEach(d=>{
      const c=d.data(), totalC=cMap[d.id]||0, totalP=pMap[d.id]||0, saldo=totalC-totalP;
      linhas.push([c.nome||'', c.telefone||'', totalC, totalP, Math.max(0,saldo), saldo>0?"Em aberto":"Quitado"]);
    });
    const ok = exportarExcel(`promissorias_${new Date().toISOString().split("T")[0]}.xlsx`, linhas);
    if (ok) window.mostrarToast("Relatório exportado!","success");
  } catch(err){ console.error(err); window.mostrarToast("Erro ao exportar.","error"); }
}

async function importarCSV(file) {
  let linhasRaw = [];
  try {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext==="xlsx"||ext==="xls") {
      if (!window.XLSX) { window.mostrarToast("Biblioteca XLSX ainda carregando.","error"); return; }
      const buf = await file.arrayBuffer();
      const wb  = window.XLSX.read(buf,{type:"array",cellDates:true});
      const ws  = wb.Sheets[wb.SheetNames[0]];
      linhasRaw = window.XLSX.utils.sheet_to_json(ws,{header:1,defval:""}).map(r=>r.map(c=>{
        if(c instanceof Date){const d=c;return`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;}
        return String(c??"").trim();
      }));
    } else {
      const texto=await file.text(), sep=texto.split("\n")[0].includes(";")?";":","
      linhasRaw=texto.split(/\r?\n/).filter(l=>l.trim()).map(l=>l.split(sep).map(v=>v.trim().replace(/^"|"$/g,"")));
    }
  } catch(err){ window.mostrarToast("Erro ao ler arquivo.","error"); return; }

  if (linhasRaw.length<2){ window.mostrarToast("Arquivo vazio ou inválido.","error"); return; }
  const cab=linhasRaw[0].map(c=>String(c).toUpperCase().replace(/\s+/g," ").trim());
  const col=(...ns)=>{ for(const n of ns){const i=cab.findIndex(c=>c.includes(n));if(i!==-1)return i;} return -1; };
  const iNome=col("NOME"), iTel=col("TELEFONE","FONE","CELULAR");
  const iC1=col("COMPRA 1"),iD1=col("DATA COMPRA 1"),iC2=col("COMPRA 2"),iD2=col("DATA COMPRA 2");
  const iC3=col("COMPRA 3"),iD3=col("DATA COMPRA 3"),iC4=col("COMPRA 4"),iD4=col("DATA COMPRA 4");
  const iC5=col("COMPRA 5"),iD5=col("DATA COMPRA 5"),iVenc=col("DATA VENCIMENTO","VENCIMENTO");
  const iPago=col("VALOR PAGO","TOTAL PAGO"),iDPag=col("DATA PAGAMENTO");

  if (iNome===-1){ window.mostrarToast("Coluna NOME não encontrada.","error"); return; }
  const dados=linhasRaw.slice(1).filter(r=>String(r[iNome]||"").trim());
  if (!dados.length){ window.mostrarToast("Nenhum cliente encontrado.","error"); return; }

  const body=`<div style="margin-bottom:var(--space-4)">
    <p style="font-size:var(--text-sm);color:var(--gray-600);margin-bottom:var(--space-3)">
      Encontrados <strong>${dados.length} cliente(s)</strong>. Nomes duplicados serão ignorados.</p>
    <div style="max-height:260px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs)">
        <thead style="position:sticky;top:0;background:#F8FAFC">
          <tr><th style="padding:8px 12px;text-align:left">Nome</th><th style="padding:8px 12px;text-align:right">Compras</th><th style="padding:8px 12px;text-align:right">Total</th><th style="padding:8px 12px;text-align:right">Pago</th></tr>
        </thead><tbody>
          ${dados.map(r=>{
            const nome=String(r[iNome]||"").trim();
            const pares=[[iC1,iD1],[iC2,iD2],[iC3,iD3],[iC4,iD4],[iC5,iD5]].filter(([iv])=>iv!==-1&&parseFloat(r[iv])>0);
            const total=pares.reduce((s,[iv])=>s+(parseFloat(r[iv])||0),0);
            const pago=iPago!==-1?(parseFloat(r[iPago])||0):0;
            return `<tr style="border-bottom:1px solid var(--gray-100)"><td style="padding:7px 12px">${escHtml(nome)}</td><td style="padding:7px 12px;text-align:right">${pares.length}</td><td style="padding:7px 12px;text-align:right">${formatarMoeda(total)}</td><td style="padding:7px 12px;text-align:right;color:#059669">${formatarMoeda(pago)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div></div>`;

  window.abrirModal("Importar — Prévia", body,
    `<button class="btn-ghost" id="btnCancProm">Cancelar</button>
     <button class="btn-primary" id="btnConfImport">Importar ${dados.length} cliente(s)</button>`);
  document.getElementById("btnCancProm").onclick=()=>window.fecharModal();
  document.getElementById("btnConfImport").onclick=async()=>{
    const btn=document.getElementById("btnConfImport");
    btn.disabled=true; btn.textContent="Importando...";
    const existSnap=await getDocs(collection(db,COL_CLIENTES));
    const existentes=new Set(); existSnap.forEach(d=>existentes.add((d.data().nome||"").toUpperCase().trim()));
    let imp=0,ign=0,erros=0;
    for (const r of dados) {
      const nome=String(r[iNome]||"").trim(); if(!nome){ign++;continue;}
      if(existentes.has(nome.toUpperCase())){ign++;continue;}
      try {
        const ref=await addDoc(collection(db,COL_CLIENTES),{nome,telefone:iTel!==-1?String(r[iTel]||"").trim():"",observacoes:"",criadoEm:serverTimestamp()});
        const cid=ref.id;
        const venc=iVenc!==-1&&r[iVenc]?parseDateCSV(String(r[iVenc])):null;
        for(const[iv,id] of [[iC1,iD1],[iC2,iD2],[iC3,iD3],[iC4,iD4],[iC5,iD5]]){
          if(iv===-1)continue; const val=parseFloat(r[iv]); if(!val||val<=0)continue;
          const dc=id!==-1&&r[id]?parseDateCSV(String(r[id])):new Date();
          await addDoc(collection(db,COL_COMPRAS),{clienteId:cid,valor:val,dataCompra:Timestamp.fromDate(dc||new Date()),vencimento:venc?Timestamp.fromDate(venc):null,observacoes:"",criadoEm:serverTimestamp()});
        }
        if(iPago!==-1){const vp=parseFloat(r[iPago]);if(vp>0){const dp=iDPag!==-1&&r[iDPag]?parseDateCSV(String(r[iDPag])):new Date();await addDoc(collection(db,COL_PAGAMENTOS),{clienteId:cid,valor:vp,dataPagamento:Timestamp.fromDate(dp||new Date()),forma:"Importado",observacoes:"Importado via planilha",criadoEm:serverTimestamp()});}}
        existentes.add(nome.toUpperCase()); imp++;
      } catch(e){ console.error(e); erros++; }
      const total=dados.length,feito=imp+ign+erros;
      const b=document.getElementById("btnConfImport"); if(b)b.textContent=`Importando... (${feito}/${total})`;
    }
    window.fecharModal();
    window.mostrarToast(`Importação: ${imp} importado(s), ${ign} ignorado(s)${erros?`, ${erros} erro(s)`:""}`,imp>0?"success":"error");
    carregarListaClientes(); carregarIndicadores();
  };
}

function parseDateCSV(v) {
  if (!v) return null;
  const m1=v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m1) return new Date(parseInt(m1[3]),parseInt(m1[2])-1,parseInt(m1[1]));
  const m2=v.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if(m2) return new Date(parseInt(m2[1]),parseInt(m2[2])-1,parseInt(m2[3]));
  const d=new Date(v); return isNaN(d)?null:d;
}

// ── Helpers ──────────────────────────────────────────────────
function badgeSituacao(sit) {
  const map = {
    "Quitado":  { bg:"#D1FAE5", color:"#065F46" },
    "Pendente": { bg:"#FEF3C7", color:"#92400E" },
    "Atrasado": { bg:"#FEE2E2", color:"#991B1B" }
  };
  const s = map[sit] || map["Pendente"];
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:9999px;font-size:0.75rem;font-weight:600;background:${s.bg};color:${s.color}">${sit}</span>`;
}

function formatarDataLocal(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR");
}
