// clientes.js — Módulo Clientes — Gerência Viviane Vargas Stories
import {
  collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, formatarData, escHtml } from "../utils/database.js";

const COL = "mj_clientes";

// ── Celular: máscara (00) 00000-0000 e validação ─────────────
function apenasDigitos(v) { return String(v || "").replace(/\D/g, ""); }

function mascararCelular(v) {
  const d = apenasDigitos(v).slice(0, 11);
  if (d.length <= 2)  return d;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function celularValido(v) {
  const n = apenasDigitos(v).length;
  return n === 10 || n === 11;
}

function ativarMascaraCelular() {
  const el = document.getElementById("mCliTelefone");
  el?.addEventListener("input", () => { el.value = mascararCelular(el.value); });
}

// Lê e valida o formulário. Retorna os dados ou null (e mostra o aviso).
function lerFormCliente() {
  const nome     = document.getElementById("mCliNome").value.trim();
  const telefone = document.getElementById("mCliTelefone").value.trim();
  const endereco = document.getElementById("mCliEndereco").value.trim();
  if (!nome) { window.mostrarToast("Informe o nome.", "error"); document.getElementById("mCliNome").focus(); return null; }
  if (!telefone) { window.mostrarToast("Informe o celular.", "error"); document.getElementById("mCliTelefone").focus(); return null; }
  if (!celularValido(telefone)) { window.mostrarToast("Celular inválido. Use DDD + número.", "error"); document.getElementById("mCliTelefone").focus(); return null; }
  return { nome, telefone, endereco };
}

export function iniciarClientes(usuario, dadosUsuario) {
  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "clientes") carregarClientesPage();
  });

  document.getElementById("btnNovoCliente")?.addEventListener("click", abrirModalNovoCliente);

  document.getElementById("btnBuscarClientes")?.addEventListener("click", () => {
    carregarListaClientes(document.getElementById("filtroBuscaClientes").value.trim());
  });
  document.getElementById("btnLimparBuscaClientes")?.addEventListener("click", () => {
    document.getElementById("filtroBuscaClientes").value = "";
    carregarListaClientes();
  });
  document.getElementById("filtroBuscaClientes")?.addEventListener("keydown", e => {
    if (e.key === "Enter") carregarListaClientes(e.target.value.trim());
  });

  document.getElementById("tbodyClientes")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "editar-cliente")  abrirModalEditarCliente(id);
    if (action === "excluir-cliente") confirmarExcluirCliente(id);
  });
}

async function carregarClientesPage() {
  await carregarListaClientes();
  atualizarIndicadoresClientes();
}

async function atualizarIndicadoresClientes() {
  try {
    const snap = await getDocs(collection(db, COL));
    const el = id => document.getElementById(id);
    if (el("indTotalClientes")) el("indTotalClientes").textContent = snap.size;
  } catch (err) { console.error(err); }
}

async function carregarListaClientes(busca = "") {
  const tbody = document.getElementById("tbodyClientes");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="loading-cell">Carregando clientes...</td></tr>`;

  try {
    const snap = await getDocs(query(collection(db, COL), orderBy("nome")));
    let clientes = [];
    snap.forEach(d => clientes.push({ id: d.id, ...d.data() }));

    if (busca) {
      const t = busca.toLowerCase();
      const tDig = apenasDigitos(busca);
      clientes = clientes.filter(c =>
        c.nome?.toLowerCase().includes(t) ||
        c.endereco?.toLowerCase().includes(t) ||
        (tDig && apenasDigitos(c.telefone).includes(tDig))
      );
    }

    if (!clientes.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Nenhum cliente encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = clientes.map(c => `
      <tr>
        <td><strong style="color:var(--gray-800)">${escHtml(c.nome)}</strong></td>
        <td style="color:var(--gray-500)">${escHtml(c.telefone ? mascararCelular(c.telefone) : "—")}</td>
        <td style="color:var(--gray-500);font-size:var(--text-sm)">${escHtml(c.endereco || "—")}</td>
        <td class="col-center" style="white-space:nowrap">
          <button class="btn-table-action btn-table-action--view" data-action="editar-cliente" data-id="${c.id}" title="Editar">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--delete" data-action="excluir-cliente" data-id="${c.id}" title="Excluir">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </td>
      </tr>`).join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Erro ao carregar clientes.</td></tr>`;
  }
}

function formBody(c = {}) {
  return `
    <div class="form-usuario">
      <div>
        <label class="field-label">Nome completo *</label>
        <input type="text" id="mCliNome" class="field-input--plain" placeholder="Nome do cliente" value="${escHtml(c.nome || "")}" autocomplete="off" />
      </div>
      <div>
        <label class="field-label">Celular / WhatsApp *</label>
        <input type="tel" id="mCliTelefone" class="field-input--plain" placeholder="(00) 00000-0000" value="${escHtml(mascararCelular(c.telefone || ""))}" inputmode="numeric" autocomplete="off" />
      </div>
      <div>
        <label class="field-label">Endereço <span style="font-weight:400;color:var(--gray-400)">(opcional)</span></label>
        <input type="text" id="mCliEndereco" class="field-input--plain" placeholder="Rua, número, bairro..." value="${escHtml(c.endereco || "")}" autocomplete="off" />
      </div>
    </div>`;
}

function abrirModalNovoCliente() {
  window.abrirModal("Novo Cliente", formBody(), `
    <button class="btn-ghost" id="btnCancCli">Cancelar</button>
    <button class="btn-primary" id="btnSalvarCli">Salvar Cliente</button>`);
  document.getElementById("btnCancCli").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarCli").onclick = salvarNovoCliente;
  ativarMascaraCelular();
  document.getElementById("mCliNome").focus();
}

async function salvarNovoCliente() {
  const dados = lerFormCliente();
  if (!dados) return;
  const btn = document.getElementById("btnSalvarCli");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await addDoc(collection(db, COL), { ...dados, criadoEm: serverTimestamp() });
    window.fecharModal();
    window.mostrarToast("Cliente cadastrado!", "success");
    carregarListaClientes();
    atualizarIndicadoresClientes();
  } catch (err) {
    window.mostrarToast("Erro ao salvar.", "error");
    btn.disabled = false; btn.textContent = "Salvar Cliente";
  }
}

async function abrirModalEditarCliente(id) {
  try {
    const snap = await getDoc(doc(db, COL, id));
    if (!snap.exists()) { window.mostrarToast("Cliente não encontrado.", "error"); return; }
    const c = snap.data();
    window.abrirModal("Editar Cliente", formBody(c), `
      <button class="btn-ghost" id="btnCancCli">Cancelar</button>
      <button class="btn-primary" id="btnSalvarCli">Salvar Alterações</button>`);
    document.getElementById("btnCancCli").onclick = () => window.fecharModal();
    document.getElementById("btnSalvarCli").onclick = () => salvarEdicaoCliente(id);
    ativarMascaraCelular();
    document.getElementById("mCliNome").focus();
  } catch (err) {
    window.mostrarToast("Erro ao carregar cliente.", "error");
  }
}

async function salvarEdicaoCliente(id) {
  const dados = lerFormCliente();
  if (!dados) return;
  const btn = document.getElementById("btnSalvarCli");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    await updateDoc(doc(db, COL, id), dados);
    window.fecharModal();
    window.mostrarToast("Cliente atualizado!", "success");
    carregarListaClientes();
  } catch (err) {
    window.mostrarToast("Erro ao salvar.", "error");
    btn.disabled = false; btn.textContent = "Salvar Alterações";
  }
}

function confirmarExcluirCliente(id) {
  window.abrirModal("Excluir Cliente",
    `<div class="delete-warning"><strong>⚠️ Atenção!</strong> Este cliente será excluído permanentemente.</div>`,
    `<button class="btn-ghost" id="btnCancCli">Cancelar</button>
     <button class="btn-danger" id="btnConfExcCli">Excluir</button>`);
  document.getElementById("btnCancCli").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcCli").onclick = () => excluirCliente(id);
}

async function excluirCliente(id) {
  const btn = document.getElementById("btnConfExcCli");
  btn.disabled = true; btn.textContent = "Excluindo...";
  try {
    await deleteDoc(doc(db, COL, id));
    window.fecharModal();
    window.mostrarToast("Cliente excluído.", "success");
    carregarListaClientes();
    atualizarIndicadoresClientes();
  } catch (err) {
    window.mostrarToast("Erro ao excluir.", "error");
    btn.disabled = false; btn.textContent = "Excluir";
  }
}
