// despesas.js — Módulo Despesas (somente admin) — Gerência Viviane Vargas Stories
import {
  collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { formatarMoeda, escHtml } from "./database.js";

const COL = "mj_despesas";

const CATEGORIAS = [
  "Aluguel", "Água", "Energia", "Internet / Telefone", "Salários",
  "Fornecedores", "Marketing", "Manutenção", "Impostos e Taxas", "Frete", "Outros"
];
const FORMAS = ["Dinheiro", "PIX", "Boleto", "Transferência", "Cartão"];

let _dadosUsuario = null;
let _lista = []; // despesas carregadas (todas), usadas nos cálculos e filtros

// ── Utilitários de data (sempre no fuso local) ───────────────
function paraDate(v) {
  if (!v) return null;
  const d = v?.toDate?.() || new Date(v);
  return isNaN(d) ? null : d;
}
function paraInput(v) {
  const d = paraDate(v);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function deInput(str) {
  return Timestamp.fromDate(new Date(str + "T12:00:00"));
}
function mesAtualStr() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}
function noMes(d, mesStr) {
  return !!d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === mesStr;
}

function badgeStatus(status) {
  const map = {
    pendente: { bg: "#FEF3C7", color: "#92400E", label: "Pendente" },
    pago:     { bg: "#D1FAE5", color: "#065F46", label: "Pago" }
  };
  const s = map[status] || map.pendente;
  return `<span style="display:inline-flex;padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;background:${s.bg};color:${s.color}">${s.label}</span>`;
}

// ── Init ─────────────────────────────────────────────────────
export function iniciarDespesas(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "despesas") {
      if (_dadosUsuario?.role !== "admin") {
        window.navegar?.("dashboard");
        window.mostrarToast?.("Acesso restrito a administradores.", "error");
        return;
      }
      const filtroMes = document.getElementById("filtroMesDespesas");
      if (filtroMes && !filtroMes.value) filtroMes.value = mesAtualStr();
      carregarDespesasPage();
    }
  });

  document.getElementById("btnNovaDespesa")?.addEventListener("click", () => abrirModalDespesa());
  document.getElementById("btnBuscarDespesas")?.addEventListener("click", renderLista);
  document.getElementById("filtroBuscaDespesas")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderLista();
  });
  ["filtroCatDespesas", "filtroStatusDespesas", "filtroMesDespesas"].forEach(id =>
    document.getElementById(id)?.addEventListener("change", renderLista)
  );
  document.getElementById("btnLimparDespesas")?.addEventListener("click", () => {
    document.getElementById("filtroBuscaDespesas").value = "";
    document.getElementById("filtroCatDespesas").value = "todas";
    document.getElementById("filtroStatusDespesas").value = "todos";
    document.getElementById("filtroMesDespesas").value = mesAtualStr();
    renderLista();
  });

  document.getElementById("tbodyDespesas")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "ver-despesa")     abrirDetalheDespesa(id);
    if (action === "editar-despesa")  abrirModalDespesa(id);
    if (action === "excluir-despesa") confirmarExcluirDespesa(id);
  });
}

// ── Carregamento ─────────────────────────────────────────────
async function carregarDespesasPage() {
  const tbody = document.getElementById("tbodyDespesas");
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Carregando...</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, COL), orderBy("data", "desc")));
    _lista = [];
    snap.forEach(d => _lista.push({ id: d.id, ...d.data() }));
    atualizarIndicadores();
    renderLista();
  } catch (err) {
    console.error(err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Erro ao carregar despesas.</td></tr>`;
  }
}

// ── Cálculos ─────────────────────────────────────────────────
function atualizarIndicadores() {
  const mes = mesAtualStr();
  let totalMes = 0, fixasMes = 0, variaveisMes = 0, aPagar = 0;
  _lista.forEach(d => {
    const v = d.valor || 0;
    if (noMes(paraDate(d.data), mes)) {
      totalMes += v;
      if (d.tipo === "fixa") fixasMes += v; else variaveisMes += v;
    }
    if (d.status === "pendente") aPagar += v;
  });
  const el = id => document.getElementById(id);
  if (el("indDespTotalMes"))   el("indDespTotalMes").textContent   = formatarMoeda(totalMes);
  if (el("indDespFixasMes"))   el("indDespFixasMes").textContent   = formatarMoeda(fixasMes);
  if (el("indDespVariaveis"))  el("indDespVariaveis").textContent  = formatarMoeda(variaveisMes);
  if (el("indDespAPagar"))     el("indDespAPagar").textContent     = formatarMoeda(aPagar);
}

function filtrarLista() {
  const busca  = document.getElementById("filtroBuscaDespesas")?.value.trim().toLowerCase() || "";
  const cat    = document.getElementById("filtroCatDespesas")?.value || "todas";
  const status = document.getElementById("filtroStatusDespesas")?.value || "todos";
  const mes    = document.getElementById("filtroMesDespesas")?.value || "";

  return _lista.filter(d => {
    if (busca && !(d.descricao?.toLowerCase().includes(busca) || d.fornecedor?.toLowerCase().includes(busca))) return false;
    if (cat !== "todas" && d.categoria !== cat) return false;
    if (status !== "todos" && d.status !== status) return false;
    if (mes && !noMes(paraDate(d.data), mes)) return false;
    return true;
  });
}

// ── Lista ────────────────────────────────────────────────────
function renderLista() {
  const tbody = document.getElementById("tbodyDespesas");
  const resumo = document.getElementById("resumoDespesas");
  if (!tbody) return;

  const lista = filtrarLista();
  const total = lista.reduce((s, d) => s + (d.valor || 0), 0);
  const pago  = lista.filter(d => d.status === "pago").reduce((s, d) => s + (d.valor || 0), 0);
  const pend  = total - pago;
  if (resumo) {
    resumo.innerHTML = `<span>${lista.length} despesa${lista.length !== 1 ? "s" : ""}</span>
      <span>Total: <strong>${formatarMoeda(total)}</strong></span>
      <span>Pago: <strong style="color:var(--color-success)">${formatarMoeda(pago)}</strong></span>
      <span>Pendente: <strong style="color:var(--color-warning)">${formatarMoeda(pend)}</strong></span>`;
  }

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhuma despesa encontrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(d => {
    const dt = paraDate(d.data);
    return `<tr>
      <td>${dt ? dt.toLocaleDateString("pt-BR") : "—"}</td>
      <td><strong style="color:var(--gray-800)">${escHtml(d.descricao || "—")}</strong></td>
      <td style="color:var(--gray-500);font-size:var(--text-sm)">${escHtml(d.categoria || "—")}</td>
      <td style="color:var(--gray-500);font-size:var(--text-sm)">${d.tipo === "fixa" ? "Fixa" : "Variável"}</td>
      <td><strong style="color:var(--gray-800)">${formatarMoeda(d.valor)}</strong></td>
      <td>${badgeStatus(d.status)}</td>
      <td class="col-center" style="white-space:nowrap">
        <button class="btn-table-action btn-table-action--view" data-action="ver-despesa" data-id="${d.id}" title="Ver detalhes">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
        </button>
        <button class="btn-table-action btn-table-action--view" data-action="editar-despesa" data-id="${d.id}" title="Editar">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
        </button>
        <button class="btn-table-action btn-table-action--delete" data-action="excluir-despesa" data-id="${d.id}" title="Excluir">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");
}

// ── Detalhe ──────────────────────────────────────────────────
function abrirDetalheDespesa(id) {
  const d = _lista.find(x => x.id === id);
  if (!d) { window.mostrarToast("Despesa não encontrada.", "error"); return; }
  const dt = paraDate(d.data);
  const campo = (rot, val) => `<div><span class="field-label">${rot}</span><p>${val}</p></div>`;
  const body = `
    <div class="form-usuario">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${campo("Descrição", escHtml(d.descricao || "—"))}
        ${campo("Valor", `<strong>${formatarMoeda(d.valor)}</strong>`)}
        ${campo("Categoria", escHtml(d.categoria || "—"))}
        ${campo("Tipo", d.tipo === "fixa" ? "Fixa" : "Variável")}
        ${campo("Data", dt ? dt.toLocaleDateString("pt-BR") : "—")}
        ${campo("Situação", badgeStatus(d.status))}
        ${campo("Forma de pagamento", escHtml(d.formaPagamento || "—"))}
        ${campo("Fornecedor / Beneficiário", escHtml(d.fornecedor || "—"))}
      </div>
      ${d.observacoes ? campo("Observações", escHtml(d.observacoes)) : ""}
    </div>`;
  window.abrirModal("Detalhes da Despesa", body,
    `<button class="btn-ghost" id="btnFecharDetDesp">Fechar</button>
     <button class="btn-primary" id="btnEditarDetDesp">Editar</button>`);
  document.getElementById("btnFecharDetDesp").onclick = () => window.fecharModal();
  document.getElementById("btnEditarDetDesp").onclick = () => abrirModalDespesa(id);
}

// ── Criar / Editar ───────────────────────────────────────────
function abrirModalDespesa(id = null) {
  const d = id ? _lista.find(x => x.id === id) : null;
  if (id && !d) { window.mostrarToast("Despesa não encontrada.", "error"); return; }

  const sel = (v, atual) => (v === atual ? "selected" : "");
  const body = `
    <div class="form-usuario">
      <div>
        <label class="field-label">Descrição *</label>
        <input type="text" id="mDespDesc" class="field-input--plain" placeholder="Ex: Conta de energia de outubro" autocomplete="off" value="${escHtml(d?.descricao || "")}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Categoria *</label>
          <select id="mDespCat" class="field-input--plain">
            ${CATEGORIAS.map(c => `<option ${sel(c, d?.categoria)}>${c}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Tipo</label>
          <select id="mDespTipo" class="field-input--plain">
            <option value="variavel" ${sel("variavel", d?.tipo || "variavel")}>Variável</option>
            <option value="fixa" ${sel("fixa", d?.tipo)}>Fixa</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Valor (R$) *</label>
          <input type="number" id="mDespValor" class="field-input--plain" placeholder="0,00" min="0.01" step="0.01" value="${d?.valor ?? ""}" />
        </div>
        <div>
          <label class="field-label">Data *</label>
          <input type="date" id="mDespData" class="field-input--plain" value="${d ? paraInput(d.data) : paraInput(new Date())}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Situação</label>
          <select id="mDespStatus" class="field-input--plain">
            <option value="pago" ${sel("pago", d?.status || "pago")}>Pago</option>
            <option value="pendente" ${sel("pendente", d?.status)}>Pendente</option>
          </select>
        </div>
        <div>
          <label class="field-label">Forma de Pagamento</label>
          <select id="mDespForma" class="field-input--plain">
            <option value="">Selecione...</option>
            ${FORMAS.map(f => `<option ${sel(f, d?.formaPagamento)}>${f}</option>`).join("")}
          </select>
        </div>
      </div>
      <div>
        <label class="field-label">Fornecedor / Beneficiário</label>
        <input type="text" id="mDespFornec" class="field-input--plain" placeholder="Opcional" value="${escHtml(d?.fornecedor || "")}" />
      </div>
      <div>
        <label class="field-label">Observações</label>
        <input type="text" id="mDespObs" class="field-input--plain" placeholder="Informações adicionais..." value="${escHtml(d?.observacoes || "")}" />
      </div>
    </div>`;

  window.abrirModal(id ? "Editar Despesa" : "Nova Despesa", body,
    `<button class="btn-ghost" id="btnCancDesp">Cancelar</button>
     <button class="btn-primary" id="btnSalvarDesp">${id ? "Salvar Alterações" : "Salvar Despesa"}</button>`);
  document.getElementById("btnCancDesp").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarDesp").onclick = () => salvarDespesa(id);
  document.getElementById("mDespDesc").focus();
}

async function salvarDespesa(id) {
  const descricao = document.getElementById("mDespDesc").value.trim();
  const valor     = parseFloat(document.getElementById("mDespValor").value);
  const dataStr   = document.getElementById("mDespData").value;

  if (!descricao)          { window.mostrarToast("Informe a descrição da despesa.", "error"); return; }
  if (!valor || valor <= 0) { window.mostrarToast("Informe um valor válido.", "error"); return; }
  if (!dataStr)            { window.mostrarToast("Informe a data da despesa.", "error"); return; }

  const dados = {
    descricao,
    categoria:      document.getElementById("mDespCat").value,
    tipo:           document.getElementById("mDespTipo").value,
    valor,
    data:           deInput(dataStr),
    status:         document.getElementById("mDespStatus").value,
    formaPagamento: document.getElementById("mDespForma").value,
    fornecedor:     document.getElementById("mDespFornec").value.trim(),
    observacoes:    document.getElementById("mDespObs").value.trim()
  };

  const btn = document.getElementById("btnSalvarDesp");
  const textoOriginal = btn.textContent;
  btn.disabled = true; btn.textContent = "Salvando...";

  try {
    if (id) {
      await updateDoc(doc(db, COL, id), dados);
    } else {
      await addDoc(collection(db, COL), {
        ...dados,
        criadoPor: _dadosUsuario?.nome || "—",
        criadoEm:  serverTimestamp()
      });
    }
    window.fecharModal();
    window.mostrarToast(id ? "Despesa atualizada!" : "Despesa cadastrada com sucesso!", "success");
    carregarDespesasPage();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao salvar despesa.", "error");
    btn.disabled = false; btn.textContent = textoOriginal;
  }
}

// ── Excluir ──────────────────────────────────────────────────
function confirmarExcluirDespesa(id) {
  window.abrirModal("Excluir Despesa",
    `<div class="delete-warning"><strong>⚠️ Confirmar exclusão</strong>Esta despesa será removida permanentemente.</div>`,
    `<button class="btn-ghost" id="btnCancExcDesp">Cancelar</button>
     <button class="btn-danger" id="btnConfExcDesp">Excluir</button>`);
  document.getElementById("btnCancExcDesp").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcDesp").onclick = async () => {
    const btn = document.getElementById("btnConfExcDesp");
    btn.disabled = true; btn.textContent = "Excluindo...";
    try {
      await deleteDoc(doc(db, COL, id));
      window.fecharModal();
      window.mostrarToast("Despesa excluída.", "success");
      carregarDespesasPage();
    } catch (err) {
      console.error(err);
      window.mostrarToast("Erro ao excluir.", "error");
      btn.disabled = false; btn.textContent = "Excluir";
    }
  };
}
