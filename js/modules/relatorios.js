// relatorios.js — Módulo Relatórios — Gerência Viviane Vargas Stories
import {
  collection, getDocs, query, orderBy, addDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, escHtml, exportarExcel } from "../utils/database.js";

const COL_VENDAS    = "mj_vendas";
const COL_COMPRAS   = "mj_compras_fornec";
const COL_PRODUTOS  = "mj_produtos";
const COL_PROM_CLI  = "prom_clientes";
const COL_PROM_COMP = "prom_compras";
const COL_PROM_PAG  = "prom_pagamentos";
const COL_CAIXA     = "mj_caixa";

let _caixaRelIniciado = false;

let _dadosUsuario = null;
const _relCharts  = {};

export function iniciarRelatorios(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "relatorios") {
      if (_dadosUsuario?.role !== "admin") {
        window.navegar?.("dashboard");
        window.mostrarToast?.("Acesso restrito a administradores.", "error");
        return;
      }
      carregarRelatoriosPage();
    }
  });

  // Abas — ao trocar de aba, carrega os dados dela (antes só a aba Caixa carregava)
  document.querySelectorAll("[data-rel-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const aba = btn.dataset.relTab;
      mudarAbaRel(aba);
      if (aba === "caixa") carregarCaixaRel();
      else gerarRelatorio(aba);
    });
  });

  document.getElementById("btnGerarRel")?.addEventListener("click", () => {
    const aba = document.querySelector(".rel-tab--active")?.dataset.relTab || "vendas";
    gerarRelatorio(aba);
  });
  document.getElementById("btnExportarRel")?.addEventListener("click", () => {
    const aba = document.querySelector(".rel-tab--active")?.dataset.relTab || "vendas";
    exportarRelatorio(aba);
  });
  document.getElementById("btnImprimirRel")?.addEventListener("click", () => window.print());

  // ── Aba Caixa (fluxo de caixa) ──
  document.getElementById("btnLancamento")?.addEventListener("click", abrirModalLancamento);
  document.getElementById("btnFiltrarCaixa")?.addEventListener("click", () => {
    carregarMovimentacoes(
      document.getElementById("filtroDataIniCaixa").value,
      document.getElementById("filtroDataFimCaixa").value,
      document.getElementById("filtroTipoCaixa").value
    );
  });
  document.getElementById("btnLimparCaixa")?.addEventListener("click", () => {
    const hoje = new Date().toISOString().split("T")[0];
    const ini7 = new Date(); ini7.setDate(ini7.getDate() - 6);
    document.getElementById("filtroDataIniCaixa").value = ini7.toISOString().split("T")[0];
    document.getElementById("filtroDataFimCaixa").value = hoje;
    document.getElementById("filtroTipoCaixa").value = "todos";
    carregarMovimentacoes();
  });
  document.getElementById("btnExportarCaixa")?.addEventListener("click", exportarCaixa);
  document.getElementById("btnImprimirCaixa")?.addEventListener("click", imprimirCaixa);
}

async function carregarCaixaRel() {
  inicializarFiltrosDatas();
  await Promise.all([carregarResumosCaixa(), carregarMovimentacoes()]);
}

function inicializarFiltrosDatas() {
  const hoje = new Date().toISOString().split("T")[0];
  const ini7 = new Date(); ini7.setDate(ini7.getDate() - 6);
  const ini7Str = ini7.toISOString().split("T")[0];
  const iniEl = document.getElementById("filtroDataIniCaixa");
  const fimEl = document.getElementById("filtroDataFimCaixa");
  if (iniEl && !iniEl.value) iniEl.value = ini7Str;
  if (fimEl && !fimEl.value) fimEl.value = hoje;
}

async function carregarResumosCaixa() {
  const el = id => document.getElementById(id);
  try {
    const hoje = new Date();
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const inicioMes  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    const [vendasSnap, comprasSnap, caixaSnap, promPagSnap] = await Promise.all([
      getDocs(collection(db, COL_VENDAS)),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_CAIXA)),
      getDocs(collection(db, COL_PROM_PAG))
    ]);

    let entradasHoje=0, saidasHoje=0, entradasMes=0, saidasMes=0;

    vendasSnap.forEach(d => {
      const v = d.data();
      if (v.status === "cancelada") return;
      if (v.formaPagamento === "Fiado") return; // ainda não é dinheiro em caixa
      const dt = v.data?.toDate?.() || new Date(v.data);
      if (dt >= inicioHoje) entradasHoje += v.total || 0;
      if (dt >= inicioMes)  entradasMes  += v.total || 0;
    });

    // Pagamentos de promissória = entrada (dinheiro recebido na hora do pagamento)
    promPagSnap.forEach(d => {
      const p = d.data();
      const dt = p.dataPagamento?.toDate?.() || new Date(p.dataPagamento);
      if (dt >= inicioHoje) entradasHoje += p.valor || 0;
      if (dt >= inicioMes)  entradasMes  += p.valor || 0;
    });

    comprasSnap.forEach(d => {
      const c = d.data();
      if (c.status !== "pago") return;
      const dt = c.dataPagamento?.toDate?.() || c.data?.toDate?.() || new Date(c.data);
      if (dt >= inicioHoje) saidasHoje += c.total || 0;
      if (dt >= inicioMes)  saidasMes  += c.total || 0;
    });

    // Lançamentos manuais
    caixaSnap.forEach(d => {
      const l = d.data();
      const dt = l.data?.toDate?.() || new Date(l.data);
      const val = l.valor || 0;
      if (l.tipo === "entrada") {
        if (dt >= inicioHoje) entradasHoje += val;
        if (dt >= inicioMes)  entradasMes  += val;
      } else {
        if (dt >= inicioHoje) saidasHoje += val;
        if (dt >= inicioMes)  saidasMes  += val;
      }
    });

    const saldoHoje = entradasHoje - saidasHoje;
    const saldoMes  = entradasMes  - saidasMes;

    if (el("indEntradasHoje"))  el("indEntradasHoje").textContent  = formatarMoeda(entradasHoje);
    if (el("indSaidasHoje"))    el("indSaidasHoje").textContent    = formatarMoeda(saidasHoje);
    if (el("indSaldoHoje"))     el("indSaldoHoje").textContent     = formatarMoeda(saldoHoje);
    if (el("indSaldoMes"))      el("indSaldoMes").textContent      = formatarMoeda(saldoMes);

    // Colorir saldo
    if (el("indSaldoHoje")) el("indSaldoHoje").style.color = saldoHoje >= 0 ? "var(--color-success)" : "var(--color-danger)";
    if (el("indSaldoMes"))  el("indSaldoMes").style.color  = saldoMes  >= 0 ? "var(--color-success)" : "var(--color-danger)";

  } catch (err) { console.error(err); }
}

async function carregarMovimentacoes(ini = "", fim = "", tipo = "todos") {
  const tbody = document.getElementById("tbodyCaixa");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="loading-cell">Carregando...</td></tr>`;

  try {
    const hoje = new Date();
    const iniDate = ini ? new Date(ini + "T00:00:00") : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6);
    const fimDate = fim ? new Date(fim + "T23:59:59") : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);

    const [vendasSnap, comprasSnap, caixaSnap, promPagSnap] = await Promise.all([
      getDocs(collection(db, COL_VENDAS)),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_CAIXA)),
      getDocs(collection(db, COL_PROM_PAG))
    ]);

    let movs = [];

    // Vendas = entradas (exceto Fiado, que ainda não é dinheiro em caixa)
    if (tipo === "todos" || tipo === "entrada") {
      vendasSnap.forEach(d => {
        const v = d.data();
        if (v.status === "cancelada") return;
        if (v.formaPagamento === "Fiado") return;
        const dt = v.data?.toDate?.() || new Date(v.data);
        if (dt >= iniDate && dt <= fimDate) {
          movs.push({
            id: d.id, tipo: "entrada",
            descricao: `Venda #${v.numero||d.id.slice(-4).toUpperCase()}`,
            categoria: "Vendas", forma: v.formaPagamento || "—",
            valor: v.total || 0, data: dt, origem: "venda"
          });
        }
      });

      // Pagamentos de promissória (cliente fiado quitando dívida) = entrada
      promPagSnap.forEach(d => {
        const p = d.data();
        const dt = p.dataPagamento?.toDate?.() || new Date(p.dataPagamento);
        if (dt >= iniDate && dt <= fimDate) {
          movs.push({
            id: d.id, tipo: "entrada",
            descricao: `Pagamento promissória${p.clienteNome ? " — " + p.clienteNome : ""}`,
            categoria: "Promissórias", forma: p.forma || "—",
            valor: p.valor || 0, data: dt, origem: "promissoria"
          });
        }
      });
    }

    // Compras pagas = saídas
    if (tipo === "todos" || tipo === "saida") {
      comprasSnap.forEach(d => {
        const c = d.data();
        if (c.status !== "pago") return;
        const dt = c.dataPagamento?.toDate?.() || c.data?.toDate?.() || new Date(c.data);
        if (dt >= iniDate && dt <= fimDate) {
          movs.push({
            id: d.id, tipo: "saida",
            descricao: `Compra: ${c.fornecedor || c.descricao || "—"}`,
            categoria: "Compras", forma: c.forma || "—",
            valor: c.total || 0, data: dt, origem: "compra"
          });
        }
      });
    }

    // Lançamentos manuais
    caixaSnap.forEach(d => {
      const l = d.data();
      const dt = l.data?.toDate?.() || new Date(l.data);
      if (dt >= iniDate && dt <= fimDate) {
        if (tipo === "todos" || tipo === l.tipo) {
          movs.push({
            id: d.id, tipo: l.tipo,
            descricao: l.descricao || "Lançamento manual",
            categoria: l.categoria || "Outros",
            forma: l.forma || "—",
            valor: l.valor || 0, data: dt, origem: "manual"
          });
        }
      }
    });

    // Ordenar por data desc
    movs.sort((a, b) => b.data - a.data);

    if (!movs.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Nenhuma movimentação encontrada no período.</td></tr>`;
      return;
    }

    let totalEntradas = 0, totalSaidas = 0;
    tbody.innerHTML = movs.map(m => {
      const isEntrada = m.tipo === "entrada";
      if (isEntrada) totalEntradas += m.valor;
      else totalSaidas += m.valor;
      const dtStr = m.data.toLocaleString("pt-BR", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
      return `<tr>
        <td style="font-size:var(--text-xs);color:var(--gray-400)">${dtStr}</td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:9999px;background:${isEntrada?"#D1FAE5":"#FEE2E2"};color:${isEntrada?"#065F46":"#991B1B"}">
            ${isEntrada?"▲ Entrada":"▼ Saída"}
          </span>
        </td>
        <td><strong style="color:var(--gray-800)">${escHtml(m.descricao)}</strong></td>
        <td style="color:var(--gray-500);font-size:var(--text-xs)">${escHtml(m.categoria)}</td>
        <td style="color:var(--gray-500);font-size:var(--text-xs)">${escHtml(m.forma)}</td>
        <td style="font-weight:700;color:${isEntrada?"var(--color-success)":"var(--color-danger)"}">
          ${isEntrada?"+":"-"} ${formatarMoeda(m.valor)}
        </td>
      </tr>`;
    }).join("");

    // Rodapé totais
    const saldo = totalEntradas - totalSaidas;
    const tfoot = document.getElementById("tfootCaixa");
    if (tfoot) {
      tfoot.innerHTML = `<tr style="background:var(--gray-50);font-weight:700">
        <td colspan="2" style="padding:10px 12px;font-size:var(--text-sm)">RESUMO DO PERÍODO</td>
        <td style="padding:10px 12px;color:var(--color-success)">Entradas: ${formatarMoeda(totalEntradas)}</td>
        <td style="padding:10px 12px;color:var(--color-danger)">Saídas: ${formatarMoeda(totalSaidas)}</td>
        <td colspan="2" style="padding:10px 12px;color:${saldo>=0?"var(--color-success)":"var(--color-danger)"}">Saldo: ${formatarMoeda(saldo)}</td>
      </tr>`;
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Erro ao carregar movimentações.</td></tr>`;
  }
}

function abrirModalLancamento() {
  const hojeStr = new Date().toISOString().split("T")[0];
  const body = `
    <div class="form-usuario">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Tipo *</label>
          <select id="mTipoLanc" class="field-input--plain">
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </select>
        </div>
        <div>
          <label class="field-label">Valor (R$) *</label>
          <input type="number" id="mValorLanc" class="field-input--plain" placeholder="0,00" min="0.01" step="0.01" />
        </div>
      </div>
      <div>
        <label class="field-label">Descrição *</label>
        <input type="text" id="mDescLanc" class="field-input--plain" placeholder="Descreva a movimentação..." />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Categoria</label>
          <select id="mCatLanc" class="field-input--plain">
            <option value="Outros">Outros</option>
            <option value="Vendas">Vendas</option>
            <option value="Compras">Compras</option>
            <option value="Salários">Salários</option>
            <option value="Aluguel">Aluguel</option>
            <option value="Energia/Água">Energia/Água</option>
            <option value="Manutenção">Manutenção</option>
            <option value="Marketing">Marketing</option>
            <option value="Impostos">Impostos</option>
          </select>
        </div>
        <div>
          <label class="field-label">Forma</label>
          <select id="mFormaLanc" class="field-input--plain">
            <option value="Dinheiro">Dinheiro</option>
            <option value="PIX">PIX</option>
            <option value="Transferência">Transferência</option>
            <option value="Cartão">Cartão</option>
            <option value="Boleto">Boleto</option>
          </select>
        </div>
        <div>
          <label class="field-label">Data *</label>
          <input type="date" id="mDataLanc" class="field-input--plain" value="${hojeStr}" />
        </div>
      </div>
    </div>`;

  window.abrirModal("Novo Lançamento", body,
    `<button class="btn-ghost" id="btnCancLanc">Cancelar</button>
     <button class="btn-primary" id="btnSalvarLanc">Registrar</button>`);

  document.getElementById("btnCancLanc").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarLanc").onclick = salvarLancamento;
  document.getElementById("mValorLanc").focus();
}

async function salvarLancamento() {
  const tipo    = document.getElementById("mTipoLanc").value;
  const valor   = parseFloat(document.getElementById("mValorLanc").value);
  const desc    = document.getElementById("mDescLanc").value.trim();
  const cat     = document.getElementById("mCatLanc").value;
  const forma   = document.getElementById("mFormaLanc").value;
  const dataStr = document.getElementById("mDataLanc").value;

  if (!desc)  { window.mostrarToast("Informe a descrição.", "error"); return; }
  if (!valor || valor <= 0) { window.mostrarToast("Informe um valor válido.", "error"); return; }
  if (!dataStr) { window.mostrarToast("Informe a data.", "error"); return; }

  const btn = document.getElementById("btnSalvarLanc");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await addDoc(collection(db, COL_CAIXA), {
      tipo, valor, descricao: desc, categoria: cat, forma,
      data: Timestamp.fromDate(new Date(dataStr + "T12:00:00")),
      operador: _dadosUsuario?.nome || "—",
      criadoEm: serverTimestamp()
    });
    window.fecharModal();
    window.mostrarToast("Lançamento registrado!", "success");
    carregarCaixaRel();
  } catch (err) {
    window.mostrarToast("Erro ao registrar.", "error");
    btn.disabled = false; btn.textContent = "Registrar";
  }
}

async function exportarCaixa() {
  try {
    const ini = document.getElementById("filtroDataIniCaixa")?.value || "";
    const fim = document.getElementById("filtroDataFimCaixa")?.value || "";
    const iniDate = ini ? new Date(ini + "T00:00:00") : new Date(0);
    const fimDate = fim ? new Date(fim + "T23:59:59") : new Date();

    const [vendasSnap, comprasSnap, caixaSnap, promPagSnap] = await Promise.all([
      getDocs(collection(db, COL_VENDAS)),
      getDocs(collection(db, COL_COMPRAS)),
      getDocs(collection(db, COL_CAIXA)),
      getDocs(collection(db, COL_PROM_PAG))
    ]);

    const linhas = [["Data","Tipo","Descrição","Categoria","Forma","Valor"]];

    vendasSnap.forEach(d => {
      const v = d.data(); if (v.status === "cancelada") return;
      if (v.formaPagamento === "Fiado") return; // ainda não é dinheiro em caixa
      const dt = v.data?.toDate?.() || new Date(v.data);
      if (dt >= iniDate && dt <= fimDate)
        linhas.push([dt.toLocaleDateString("pt-BR"), "Entrada", `Venda #${v.numero||""}`, "Vendas", v.formaPagamento||"", v.total||0]);
    });
    promPagSnap.forEach(d => {
      const p = d.data();
      const dt = p.dataPagamento?.toDate?.() || new Date(p.dataPagamento);
      if (dt >= iniDate && dt <= fimDate)
        linhas.push([dt.toLocaleDateString("pt-BR"), "Entrada", `Pagamento promissória${p.clienteNome ? " — " + p.clienteNome : ""}`, "Promissórias", p.forma||"", p.valor||0]);
    });
    comprasSnap.forEach(d => {
      const c = d.data(); if (c.status !== "pago") return;
      const dt = c.dataPagamento?.toDate?.() || c.data?.toDate?.() || new Date(c.data);
      if (dt >= iniDate && dt <= fimDate)
        linhas.push([dt.toLocaleDateString("pt-BR"), "Saída", c.fornecedor||"", "Compras", c.forma||"", c.total||0]);
    });
    caixaSnap.forEach(d => {
      const l = d.data();
      const dt = l.data?.toDate?.() || new Date(l.data);
      if (dt >= iniDate && dt <= fimDate)
        linhas.push([dt.toLocaleDateString("pt-BR"), l.tipo==="entrada"?"Entrada":"Saída", l.descricao||"", l.categoria||"", l.forma||"", l.valor||0]);
    });

    const ok = exportarExcel(`caixa_${new Date().toISOString().split("T")[0]}.xlsx`, linhas);
    if (ok) window.mostrarToast("Caixa exportado!", "success");
  } catch (err) { console.error(err); window.mostrarToast("Erro ao exportar.", "error"); }
}

async function imprimirCaixa() {
  const ini = document.getElementById("filtroDataIniCaixa")?.value || "";
  const fim = document.getElementById("filtroDataFimCaixa")?.value || "";
  const rows = document.querySelectorAll("#tbodyCaixa tr");
  const tfoot = document.getElementById("tfootCaixa")?.innerHTML || "";
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>Caixa — Gerência Viviane Vargas Stories</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px;color:#111}h1{font-size:18px}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#715338;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
    td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11px}</style></head><body>
    <h1>Gerência Viviane Vargas Stories — Fluxo de Caixa</h1>
    <p style="color:#555;font-size:11px">Período: ${ini||"—"} a ${fim||"—"} · Emitido em ${new Date().toLocaleDateString("pt-BR")}</p>
    <table><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Valor</th></tr></thead>
    <tbody>${Array.from(rows).map(r=>r.outerHTML).join("")}</tbody>
    <tfoot>${tfoot}</tfoot></table>
    <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  win.document.close();
}

function mudarAbaRel(aba) {
  document.querySelectorAll("[data-rel-tab]").forEach(b => {
    b.classList.toggle("rel-tab--active", b.dataset.relTab === aba);
  });
  document.querySelectorAll("[data-rel-painel]").forEach(p => {
    p.hidden = p.dataset.relPainel !== aba;
  });
}

async function carregarRelatoriosPage() {
  mudarAbaRel("vendas");
  await gerarRelatorio("vendas");
}

async function gerarRelatorio(aba) {
  const ini = document.getElementById("relDataIni")?.value || "";
  const fim = document.getElementById("relDataFim")?.value || "";
  const iniDate = ini ? new Date(ini + "T00:00:00") : new Date(0);
  const fimDate = fim ? new Date(fim + "T23:59:59") : new Date();

  if (aba === "vendas")    await relVendas(iniDate, fimDate);
  if (aba === "produtos")  await relProdutos(iniDate, fimDate);
  if (aba === "compras")   await relCompras(iniDate, fimDate);
  if (aba === "promissoria") await relPromissoria();
}

// ── Relatório de Vendas ───────────────────────────────────────
async function relVendas(iniDate, fimDate) {
  const el = id => document.getElementById(id);
  try {
    const snap = await getDocs(query(collection(db, COL_VENDAS), orderBy("data", "desc")));
    let vendas = [];
    snap.forEach(d => {
      const v = d.data();
      if (v.status === "cancelada") return;
      const dt = v.data?.toDate?.() || new Date(v.data);
      if (dt >= iniDate && dt <= fimDate) vendas.push({ id: d.id, ...v, dt });
    });

    const totalRec = vendas.reduce((s, v) => s + (v.total || 0), 0);
    const ticketM  = vendas.length ? totalRec / vendas.length : 0;

    // Por forma de pagamento
    const porForma = {};
    vendas.forEach(v => {
      if (Array.isArray(v.pagamentos) && v.pagamentos.length) {
        v.pagamentos.forEach(p => {
          const f = p.forma || "Não informado";
          porForma[f] = (porForma[f] || 0) + (p.valor || 0);
        });
        return;
      }
      const f = v.formaPagamento || "Não informado";
      porForma[f] = (porForma[f] || 0) + (v.total || 0);
    });

    // Por dia (últimos 30 dias)
    const porDia = {};
    vendas.forEach(v => {
      const k = v.dt.toLocaleDateString("pt-BR");
      porDia[k] = (porDia[k] || 0) + (v.total || 0);
    });

    // KPIs
    if (el("relVendasQtd"))    el("relVendasQtd").textContent    = vendas.length;
    if (el("relVendasTotal"))  el("relVendasTotal").textContent  = formatarMoeda(totalRec);
    if (el("relVendasTicket")) el("relVendasTicket").textContent = formatarMoeda(ticketM);
    if (el("relVendasCancel")) {
      let canceladas = 0;
      snap.forEach(d => { if (d.data().status === "cancelada") canceladas++; });
      el("relVendasCancel").textContent = canceladas;
    }

    // Tabela
    const tbody = el("tbodyRelVendas");
    if (tbody) {
      if (!vendas.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Nenhuma venda no período.</td></tr>`;
      } else {
        tbody.innerHTML = vendas.slice(0, 50).map(v => `<tr>
          <td style="color:var(--gray-400);font-size:var(--text-xs)">#${v.numero||v.id.slice(-4).toUpperCase()}</td>
          <td>${v.dt.toLocaleDateString("pt-BR")}</td>
          <td>${escHtml(v.operador||"—")}</td>
          <td>${escHtml(v.formaPagamento||"—")}</td>
          <td style="font-weight:600">${formatarMoeda(v.total)}</td>
        </tr>`).join("");
        if (vendas.length > 50) {
          tbody.innerHTML += `<tr><td colspan="5" class="empty-cell" style="font-style:italic">... e mais ${vendas.length - 50} vendas</td></tr>`;
        }
      }
    }

    // Gráfico forma de pagamento
    if (typeof Chart !== "undefined" && el("chartRelForma")) {
      if (_relCharts.forma) { _relCharts.forma.destroy(); delete _relCharts.forma; }
      _relCharts.forma = new Chart(el("chartRelForma"), {
        type: "doughnut",
        data: {
          labels: Object.keys(porForma),
          datasets: [{ data: Object.values(porForma), backgroundColor: ["#B79061","#10B981","#F59E0B","#8B5CF6","#EF4444","#94A3B8"], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, cutout: "60%" }
      });
    }

    // Gráfico por dia
    if (typeof Chart !== "undefined" && el("chartRelVendasDia")) {
      if (_relCharts.vendasDia) { _relCharts.vendasDia.destroy(); delete _relCharts.vendasDia; }
      const dias = Object.keys(porDia).sort((a, b) => {
        const [da, ma, ya] = a.split("/").map(Number);
        const [db2, mb, yb] = b.split("/").map(Number);
        return new Date(ya, ma-1, da) - new Date(yb, mb-1, db2);
      }).slice(-14);
      _relCharts.vendasDia = new Chart(el("chartRelVendasDia"), {
        type: "bar",
        data: {
          labels: dias,
          datasets: [{ label: "Vendas (R$)", data: dias.map(d => porDia[d] || 0), backgroundColor: "#B79061", borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => formatarMoeda(v) } } }
        }
      });
    }
  } catch (err) { console.error(err); }
}

// ── Relatório de Produtos ─────────────────────────────────────
async function relProdutos(iniDate, fimDate) {
  const el = id => document.getElementById(id);
  try {
    const snap = await getDocs(query(collection(db, COL_PRODUTOS), orderBy("nome")));
    const produtos = [];
    let totalInv = 0, abaixoMin = 0, semEstoque = 0;
    snap.forEach(d => {
      const p = { id: d.id, ...d.data() };
      totalInv += (p.estoque || 0) * (p.precoCusto || 0);
      if ((p.estoqueMinimo||0) > 0 && (p.estoque||0) <= (p.estoqueMinimo||0)) abaixoMin++;
      if ((p.estoque||0) <= 0) semEstoque++;
      produtos.push(p);
    });

    if (el("relProdTotal"))   el("relProdTotal").textContent   = snap.size;
    if (el("relProdInv"))     el("relProdInv").textContent     = formatarMoeda(totalInv);
    if (el("relProdBaixo"))   el("relProdBaixo").textContent   = abaixoMin;
    if (el("relProdSem"))     el("relProdSem").textContent     = semEstoque;

    // Por categoria
    const porCat = {};
    produtos.forEach(p => {
      const c = p.categoria || "Sem categoria";
      if (!porCat[c]) porCat[c] = { qtd: 0, valor: 0 };
      porCat[c].qtd   += p.estoque || 0;
      porCat[c].valor += (p.estoque || 0) * (p.precoCusto || 0);
    });

    // Tabela
    const tbody = el("tbodyRelProdutos");
    if (tbody) {
      // Mostrar os críticos primeiro
      const sorted = [...produtos].sort((a, b) => {
        const aMin = (a.estoqueMinimo||0), aEst = (a.estoque||0);
        const bMin = (b.estoqueMinimo||0), bEst = (b.estoque||0);
        const aCrit = aMin > 0 && aEst <= aMin ? 0 : 1;
        const bCrit = bMin > 0 && bEst <= bMin ? 0 : 1;
        return aCrit - bCrit || aEst - bEst;
      });
      tbody.innerHTML = sorted.map(p => {
        const critico = (p.estoqueMinimo||0) > 0 && (p.estoque||0) <= (p.estoqueMinimo||0);
        const semEst  = (p.estoque||0) <= 0;
        return `<tr style="${critico?"background:#FFF7F0":""}">
          <td>${escHtml(p.nome)}</td>
          <td style="color:var(--gray-400);font-size:var(--text-xs)">${escHtml(p.categoria||"—")}</td>
          <td style="text-align:center">
            <strong style="color:${semEst?"#DC2626":critico?"#D97706":"inherit"}">${p.estoque||0}</strong>
            ${critico&&!semEst?`<span style="font-size:0.65rem;color:#D97706;margin-left:4px">⚠ baixo</span>`:""}
            ${semEst?`<span style="font-size:0.65rem;color:#DC2626;margin-left:4px">✗ zerado</span>`:""}
          </td>
          <td style="text-align:center;color:var(--gray-400)">${p.estoqueMinimo||"—"}</td>
          <td>${formatarMoeda(p.precoVenda)}</td>
          <td>${formatarMoeda(p.precoCusto)}</td>
          <td style="font-weight:600">${formatarMoeda((p.estoque||0)*(p.precoCusto||0))}</td>
        </tr>`;
      }).join("");
    }

    // Gráfico categorias
    if (typeof Chart !== "undefined" && el("chartRelCat")) {
      if (_relCharts.cat) { _relCharts.cat.destroy(); delete _relCharts.cat; }
      const cats = Object.keys(porCat).sort((a,b) => porCat[b].valor - porCat[a].valor).slice(0, 8);
      _relCharts.cat = new Chart(el("chartRelCat"), {
        type: "bar",
        data: {
          labels: cats,
          datasets: [{ label: "Valor Inventário", data: cats.map(c => porCat[c].valor), backgroundColor: "#8B5CF6", borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => formatarMoeda(v) } } }
        }
      });
    }
  } catch (err) { console.error(err); }
}

// ── Relatório de Compras ──────────────────────────────────────
async function relCompras(iniDate, fimDate) {
  const el = id => document.getElementById(id);
  try {
    const snap = await getDocs(collection(db, COL_COMPRAS));
    let compras = [];
    snap.forEach(d => {
      const c = d.data();
      const dt = c.data?.toDate?.() || new Date(c.data);
      if (dt >= iniDate && dt <= fimDate) compras.push({ id: d.id, ...c, dt });
    });

    const totalPago     = compras.filter(c => c.status==="pago").reduce((s,c) => s+(c.total||0), 0);
    const totalPendente = compras.filter(c => c.status==="pendente").reduce((s,c) => s+(c.total||0), 0);
    const qtdAtrasado   = compras.filter(c => {
      const venc = c.vencimento?.toDate?.() || (c.vencimento ? new Date(c.vencimento) : null);
      return c.status === "pendente" && venc && venc < new Date();
    }).length;

    if (el("relCompTotal"))   el("relCompTotal").textContent   = compras.length;
    if (el("relCompPago"))    el("relCompPago").textContent    = formatarMoeda(totalPago);
    if (el("relCompPend"))    el("relCompPend").textContent    = formatarMoeda(totalPendente);
    if (el("relCompAtraso"))  el("relCompAtraso").textContent  = qtdAtrasado;

    const tbody = el("tbodyRelCompras");
    if (tbody) {
      if (!compras.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">Nenhuma compra no período.</td></tr>`;
      } else {
        compras.sort((a, b) => b.dt - a.dt);
        tbody.innerHTML = compras.map(c => {
          const venc = c.vencimento?.toDate?.() || null;
          const atras = venc && venc < new Date() && c.status === "pendente";
          return `<tr>
            <td>${escHtml(c.fornecedor||"—")}</td>
            <td style="font-size:var(--text-xs);color:var(--gray-500)">${escHtml(c.descricao||"—")}</td>
            <td>${c.dt.toLocaleDateString("pt-BR")}</td>
            <td>${venc?`<span style="color:${atras?"#DC2626":"inherit"}">${venc.toLocaleDateString("pt-BR")}</span>`:"—"}</td>
            <td style="font-weight:600">${formatarMoeda(c.total)}</td>
            <td><span style="font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:9999px;background:${atras?"#FEE2E2":c.status==="pago"?"#D1FAE5":"#FEF3C7"};color:${atras?"#991B1B":c.status==="pago"?"#065F46":"#92400E"}">${atras?"Atrasado":c.status==="pago"?"Pago":"Pendente"}</span></td>
          </tr>`;
        }).join("");
      }
    }

    // Gráfico por fornecedor
    const porForn = {};
    compras.forEach(c => {
      const f = c.fornecedor || "Outros";
      porForn[f] = (porForn[f] || 0) + (c.total || 0);
    });
    if (typeof Chart !== "undefined" && el("chartRelForn")) {
      if (_relCharts.forn) { _relCharts.forn.destroy(); delete _relCharts.forn; }
      const ferns = Object.keys(porForn).sort((a,b) => porForn[b]-porForn[a]).slice(0,8);
      _relCharts.forn = new Chart(el("chartRelForn"), {
        type: "bar",
        data: {
          labels: ferns,
          datasets: [{ label: "Total Comprado", data: ferns.map(f => porForn[f]), backgroundColor: "#10B981", borderRadius: 4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { callback: v => formatarMoeda(v) } } }
        }
      });
    }
  } catch (err) { console.error(err); }
}

// ── Relatório de Promissórias ─────────────────────────────────
async function relPromissoria() {
  const el = id => document.getElementById(id);
  try {
    const [cliSnap, compSnap, pagSnap] = await Promise.all([
      getDocs(collection(db, COL_PROM_CLI)),
      getDocs(collection(db, COL_PROM_COMP)),
      getDocs(collection(db, COL_PROM_PAG))
    ]);

    const saldoMap = {};
    compSnap.forEach(d => {
      const c = d.data();
      if (!saldoMap[c.clienteId]) saldoMap[c.clienteId] = { comp: 0, pago: 0 };
      saldoMap[c.clienteId].comp += c.valor || 0;
    });
    pagSnap.forEach(d => {
      const p = d.data();
      if (!saldoMap[p.clienteId]) saldoMap[p.clienteId] = { comp: 0, pago: 0 };
      saldoMap[p.clienteId].pago += p.valor || 0;
    });

    const totalVend  = compSnap.docs.reduce((s, d) => s + (d.data().valor || 0), 0);
    const totalRec   = pagSnap.docs.reduce((s, d) => s + (d.data().valor || 0), 0);
    const totalAberto = Math.max(0, totalVend - totalRec);
    let inadimplentes = 0;
    const hoje = new Date();
    compSnap.forEach(d => {
      const c = d.data();
      const s = saldoMap[c.clienteId];
      if (s && s.comp - s.pago > 0) {
        const venc = c.vencimento?.toDate?.() || null;
        if (venc && venc < hoje) inadimplentes++;
      }
    });

    if (el("relPromVend"))   el("relPromVend").textContent   = formatarMoeda(totalVend);
    if (el("relPromRec"))    el("relPromRec").textContent    = formatarMoeda(totalRec);
    if (el("relPromAberto")) el("relPromAberto").textContent = formatarMoeda(totalAberto);
    if (el("relPromInad"))   el("relPromInad").textContent   = inadimplentes;

    // Tabela top devedores
    const tbody = el("tbodyRelProm");
    if (tbody) {
      const clientes = [];
      cliSnap.forEach(d => {
        const cli = { id: d.id, ...d.data() };
        const s = saldoMap[cli.id] || { comp: 0, pago: 0 };
        cli.saldo = Math.max(0, s.comp - s.pago);
        cli.totalComp = s.comp;
        cli.totalPago = s.pago;
        clientes.push(cli);
      });
      clientes.sort((a,b) => b.saldo - a.saldo);
      tbody.innerHTML = clientes.map(cli => `<tr>
        <td><strong>${escHtml(cli.nome||"—")}</strong></td>
        <td style="color:var(--gray-400);font-size:var(--text-xs)">${escHtml(cli.telefone||"—")}</td>
        <td>${formatarMoeda(cli.totalComp)}</td>
        <td style="color:var(--color-success)">${formatarMoeda(cli.totalPago)}</td>
        <td style="font-weight:700;color:${cli.saldo>0?"var(--color-danger)":"var(--color-success)"}">${formatarMoeda(cli.saldo)}</td>
        <td>${cli.saldo <= 0
          ? `<span style="padding:2px 8px;border-radius:9999px;font-size:0.7rem;background:#D1FAE5;color:#065F46;font-weight:600">Quitado</span>`
          : `<span style="padding:2px 8px;border-radius:9999px;font-size:0.7rem;background:#FEF3C7;color:#92400E;font-weight:600">Pendente</span>`}</td>
      </tr>`).join("");
    }
  } catch (err) { console.error(err); }
}

async function exportarRelatorio(aba) {
  try {
    let linhas = [], nome = "relatorio";
    if (aba === "vendas") {
      const snap = await getDocs(collection(db, COL_VENDAS));
      linhas = [["Número","Data","Operador","Forma Pagamento","Total","Status"]];
      snap.forEach(d => {
        const v = d.data();
        const dt = v.data?.toDate?.() || new Date(v.data);
        linhas.push([v.numero||"", isNaN(dt)?"":dt.toLocaleDateString("pt-BR"), v.operador||"", v.formaPagamento||"", v.total||0, v.status||""]);
      });
      nome = "relatorio_vendas";
    } else if (aba === "produtos") {
      const snap = await getDocs(collection(db, COL_PRODUTOS));
      linhas = [["Nome","Categoria","Estoque","Mínimo","Preço Venda","Preço Custo","Valor Inventário"]];
      snap.forEach(d => {
        const p = d.data();
        linhas.push([p.nome||"", p.categoria||"", p.estoque||0, p.estoqueMinimo||0, p.precoVenda||0, p.precoCusto||0, (p.estoque||0)*(p.precoCusto||0)]);
      });
      nome = "relatorio_produtos";
    } else if (aba === "compras") {
      const snap = await getDocs(collection(db, COL_COMPRAS));
      linhas = [["Fornecedor","Descrição","Data","Vencimento","Total","Status"]];
      snap.forEach(d => {
        const c = d.data();
        const dt = c.data?.toDate?.() || new Date(c.data);
        const venc = c.vencimento?.toDate?.() || null;
        linhas.push([c.fornecedor||"", c.descricao||"", isNaN(dt)?"":dt.toLocaleDateString("pt-BR"), venc?venc.toLocaleDateString("pt-BR"):"", c.total||0, c.status||""]);
      });
      nome = "relatorio_compras";
    } else if (aba === "promissoria") {
      const [cliSnap, compSnap, pagSnap] = await Promise.all([
        getDocs(collection(db, COL_PROM_CLI)),
        getDocs(collection(db, COL_PROM_COMP)),
        getDocs(collection(db, COL_PROM_PAG))
      ]);
      const cm={}, pm={};
      compSnap.forEach(d=>{const c=d.data();cm[c.clienteId]=(cm[c.clienteId]||0)+(c.valor||0);});
      pagSnap.forEach(d=>{const p=d.data();pm[p.clienteId]=(pm[p.clienteId]||0)+(p.valor||0);});
      linhas = [["Nome","Telefone","Total Comprado","Total Pago","Saldo Devedor"]];
      cliSnap.forEach(d=>{const c=d.data();const s=Math.max(0,(cm[d.id]||0)-(pm[d.id]||0));linhas.push([c.nome||"", c.telefone||"", cm[d.id]||0, pm[d.id]||0, s]);});
      nome = "relatorio_promissorias";
    }
    const ok = exportarExcel(`${nome}_${new Date().toISOString().split("T")[0]}.xlsx`, linhas);
    if (ok) window.mostrarToast("Relatório exportado!", "success");
  } catch (err) { window.mostrarToast("Erro ao exportar.", "error"); }
}
