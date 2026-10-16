// compras.js — Módulo Compras (Fornecedores) — Gerência Viviane Vargas Stories
import {
  collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, escHtml, exportarExcel } from "../utils/database.js";

const COL_COMPRAS  = "vv_compras_fornec";
const COL_PRODUTOS = "vv_produtos";

let _dadosUsuario = null;
let _anexosAtuais = []; // [{ tipo: 'imagem'|'pdf', nome, dados (base64) }]

function redimensionarImagemCompra(file, maxLado = 1000, qualidade = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo não é uma imagem válida"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) { height = Math.round(height * (maxLado / width)); width = maxLado; }
        else if (height > maxLado) { width = Math.round(width * (maxLado / height)); height = maxLado; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

async function adicionarAnexos(fileList) {
  for (const file of Array.from(fileList)) {
    try {
      if (file.type.startsWith("image/")) {
        const dados = await redimensionarImagemCompra(file);
        _anexosAtuais.push({ tipo: "imagem", nome: file.name, dados });
      } else if (file.type === "application/pdf") {
        if (file.size > 900 * 1024) {
          window.mostrarToast(`"${file.name}" é muito grande (máx. ~900KB por anexo).`, "error");
          continue;
        }
        const dados = await lerArquivoBase64(file);
        _anexosAtuais.push({ tipo: "pdf", nome: file.name, dados });
      } else {
        window.mostrarToast(`Tipo de arquivo não suportado: ${file.name}`, "error");
      }
    } catch (err) { console.error(err); window.mostrarToast(`Erro ao processar "${file.name}".`, "error"); }
  }
  renderAnexosPreview();
}

function renderAnexosPreview() {
  const cont = document.getElementById("comprasAnexosPreview");
  if (!cont) return;
  if (!_anexosAtuais.length) { cont.innerHTML = ""; return; }
  cont.innerHTML = _anexosAtuais.map((a, idx) => `
    <div class="anexo-thumb" data-idx="${idx}">
      ${a.tipo === "imagem"
        ? `<img src="${a.dados}" alt="${escHtml(a.nome)}" />`
        : `<div class="anexo-thumb__pdf">📄</div>`}
      <button type="button" class="anexo-thumb__remove" data-rem-anexo="${idx}" title="Remover">×</button>
      <small>${escHtml(a.nome.length > 16 ? a.nome.slice(0, 14) + "…" : a.nome)}</small>
    </div>`).join("");
  cont.querySelectorAll("[data-rem-anexo]").forEach(btn => {
    btn.addEventListener("click", () => {
      _anexosAtuais.splice(parseInt(btn.dataset.remAnexo), 1);
      renderAnexosPreview();
    });
  });
}

export function iniciarCompras(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "compras") {
      if (_dadosUsuario?.role !== "admin") {
        window.navegar?.("dashboard");
        window.mostrarToast?.("Acesso restrito a administradores.", "error");
        return;
      }
      carregarComprasPage();
    }
  });

  document.getElementById("btnNovaCompra")?.addEventListener("click", abrirModalNovaCompra);
  document.getElementById("btnBuscarCompras")?.addEventListener("click", () => {
    carregarListaCompras(
      document.getElementById("filtroBuscaCompras").value.trim(),
      document.getElementById("filtroStatusCompras").value
    );
  });
  document.getElementById("btnLimparCompras")?.addEventListener("click", () => {
    document.getElementById("filtroBuscaCompras").value = "";
    document.getElementById("filtroStatusCompras").value = "todos";
    carregarListaCompras();
  });
  document.getElementById("btnExportarCompras")?.addEventListener("click", exportarCompras);

  document.getElementById("tbodyCompras")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "ver-compra")     abrirDetalheCompra(btn.dataset.id);
    if (btn.dataset.action === "pagar-compra")   abrirModalPagarCompra(btn.dataset.id);
    if (btn.dataset.action === "excluir-compra") confirmarExcluirCompra(btn.dataset.id);
  });
}

async function carregarComprasPage() {
  await Promise.all([carregarIndicadoresCompras(), carregarListaCompras()]);
}

async function carregarIndicadoresCompras() {
  const el = id => document.getElementById(id);
  try {
    const snap = await getDocs(collection(db, COL_COMPRAS));
    let totalPendente=0, totalPago=0, qtdPendente=0;
    snap.forEach(d => {
      const c = d.data();
      if (c.status === "pendente") { totalPendente += c.total || 0; qtdPendente++; }
      else if (c.status === "pago") totalPago += c.total || 0;
    });
    if (el("indComprasPendentes")) el("indComprasPendentes").textContent = qtdPendente;
    if (el("indTotalComprasPend")) el("indTotalComprasPend").textContent = formatarMoeda(totalPendente);
    if (el("indTotalComprasPago")) el("indTotalComprasPago").textContent = formatarMoeda(totalPago);
    if (el("indTotalComprasMes")) {
      const inicioMes = new Date(); inicioMes.setDate(1);
      let mes = 0;
      snap.forEach(d => {
        const c = d.data();
        const dt = c.data?.toDate?.() || new Date(c.data);
        if (dt >= inicioMes) mes += c.total || 0;
      });
      el("indTotalComprasMes").textContent = formatarMoeda(mes);
    }
  } catch (err) { console.error(err); }
}

async function carregarListaCompras(busca = "", status = "todos") {
  const tbody = document.getElementById("tbodyCompras");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Carregando...</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, COL_COMPRAS), orderBy("data", "desc")));
    let compras = [];
    snap.forEach(d => compras.push({ id: d.id, ...d.data() }));

    if (busca) {
      const t = busca.toLowerCase();
      compras = compras.filter(c => c.fornecedor?.toLowerCase().includes(t) || c.descricao?.toLowerCase().includes(t));
    }
    if (status !== "todos") compras = compras.filter(c => c.status === status);

    if (!compras.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhuma compra encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = compras.map(c => {
      const dt = c.data?.toDate?.() || new Date(c.data);
      const dtStr = isNaN(dt) ? "—" : dt.toLocaleDateString("pt-BR");
      const venc = c.vencimento?.toDate?.() || (c.vencimento ? new Date(c.vencimento) : null);
      const atrasado = venc && venc < new Date() && c.status === "pendente";
      return `<tr>
        <td>${escHtml(c.fornecedor || "—")}</td>
        <td style="color:var(--gray-500);font-size:var(--text-sm)">${escHtml(c.descricao || "—")}</td>
        <td>${dtStr}</td>
        <td>${venc ? `<span style="color:${atrasado?"#DC2626":"inherit"}">${venc.toLocaleDateString("pt-BR")}</span>` : "—"}</td>
        <td>${escHtml(c.formaPagamento || c.forma || "—")}</td>
        <td><strong style="color:var(--gray-800)">${formatarMoeda(c.total)}</strong></td>
        <td class="col-center" style="white-space:nowrap">
          ${badgeStatusCompra(c.status, atrasado)}
          <button class="btn-table-action btn-table-action--view" data-action="ver-compra" data-id="${c.id}" title="Ver detalhes" style="margin-left:4px">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
          </button>
          ${c.status === "pendente" ? `
          <button class="btn-table-action" data-action="pagar-compra" data-id="${c.id}" title="Marcar como pago" style="color:var(--color-success)">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
          </button>` : ""}
          <button class="btn-table-action btn-table-action--delete" data-action="excluir-compra" data-id="${c.id}" title="Excluir">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </td>
      </tr>`;
    }).join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Erro ao carregar compras.</td></tr>`;
  }
}

async function abrirModalNovaCompra() {
  const hojeStr = new Date().toISOString().split("T")[0];
  const venc30  = new Date(); venc30.setDate(venc30.getDate() + 30);
  const vencStr = venc30.toISOString().split("T")[0];

  let produtos = [];
  try {
    const snap = await getDocs(query(collection(db, COL_PRODUTOS), orderBy("nome")));
    snap.forEach(d => produtos.push({ id: d.id, ...d.data() }));
  } catch (err) { console.error(err); }

  const opsProd = produtos.map(p =>
    `<option value="${p.id}">${escHtml(p.nome)} (estoque: ${p.estoque||0})</option>`
  ).join("");

  const body = `
    <div class="form-usuario">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Fornecedor *</label>
          <input type="text" id="mFornec" class="field-input--plain" placeholder="Nome do fornecedor" autocomplete="off" />
        </div>
        <div>
          <label class="field-label">Nota Fiscal / Ref.</label>
          <input type="text" id="mNFCompra" class="field-input--plain" placeholder="NF-0001" />
        </div>
      </div>
      <div>
        <label class="field-label">Descrição / Itens *</label>
        <input type="text" id="mDescCompra" class="field-input--plain" placeholder="Ex: Arroz 50kg, Feijão 30kg..." />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Total (R$) *</label>
          <input type="number" id="mTotalCompra" class="field-input--plain" placeholder="0,00" min="0.01" step="0.01" />
        </div>
        <div>
          <label class="field-label">Data *</label>
          <input type="date" id="mDataCompra" class="field-input--plain" value="${hojeStr}" />
        </div>
        <div>
          <label class="field-label">Vencimento</label>
          <input type="date" id="mVencCompra" class="field-input--plain" value="${vencStr}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Forma de Pagamento</label>
          <select id="mFormaCompra" class="field-input--plain">
            <option value="">Selecione...</option>
            <option>Dinheiro</option><option>PIX</option>
            <option>Boleto</option><option>Transferência</option><option>Cartão</option>
          </select>
        </div>
        <div>
          <label class="field-label">Status</label>
          <select id="mStatusCompra" class="field-input--plain">
            <option value="pendente">Pendente</option>
            <option value="pago">Pago</option>
          </select>
        </div>
      </div>
      <div>
        <label class="field-label">Atualizar estoque do produto (opcional)</label>
        <div style="display:grid;grid-template-columns:1fr 120px;gap:8px">
          <select id="mProdEstoqueComp" class="field-input--plain">
            <option value="">Não atualizar estoque</option>
            ${opsProd}
          </select>
          <input type="number" id="mQtdEstoqueComp" class="field-input--plain" placeholder="Qtd." min="0" step="1" value="0" />
        </div>
      </div>
      <div>
        <label class="field-label">Observações</label>
        <input type="text" id="mObsCompra" class="field-input--plain" placeholder="Informações adicionais..." />
      </div>
      <div>
        <label class="field-label">Anexar Nota Fiscal (opcional — PDF ou fotos, pode ser várias páginas)</label>
        <button type="button" class="btn-ghost" id="btnAnexarNF" style="width:100%;justify-content:center">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M8 4a3 3 0 016 0v8a5 5 0 01-10 0V6a1 1 0 112 0v6a3 3 0 006 0V4a1 1 0 10-2 0v8a1 1 0 11-2 0V4z" clip-rule="evenodd"/></svg>
          Adicionar PDF ou Fotos
        </button>
        <input type="file" id="inputAnexarNF" accept="application/pdf,image/*" multiple hidden />
        <div id="comprasAnexosPreview" class="anexos-preview-grid"></div>
      </div>
    </div>`;

  window.abrirModal("Nova Compra / Entrada", body,
    `<button class="btn-ghost" id="btnCancComp">Cancelar</button>
     <button class="btn-primary" id="btnSalvarComp">Registrar Compra</button>`);

  _anexosAtuais = [];
  document.getElementById("btnCancComp").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarComp").onclick = () => salvarNovaCompra();
  document.getElementById("btnAnexarNF").onclick = () => document.getElementById("inputAnexarNF").click();
  document.getElementById("inputAnexarNF").addEventListener("change", (e) => {
    if (e.target.files.length) adicionarAnexos(e.target.files);
    e.target.value = "";
  });
  document.getElementById("mFornec").focus();
}

async function salvarNovaCompra() {
  const fornecedor = document.getElementById("mFornec").value.trim();
  const descricao  = document.getElementById("mDescCompra").value.trim();
  const total      = parseFloat(document.getElementById("mTotalCompra").value);
  const dataStr    = document.getElementById("mDataCompra").value;
  const vencStr    = document.getElementById("mVencCompra").value;
  const forma      = document.getElementById("mFormaCompra").value;
  const status     = document.getElementById("mStatusCompra").value;
  const nf         = document.getElementById("mNFCompra").value.trim();
  const obs        = document.getElementById("mObsCompra").value.trim();
  const prodId     = document.getElementById("mProdEstoqueComp").value;
  const qtdEst     = parseInt(document.getElementById("mQtdEstoqueComp").value) || 0;

  if (!fornecedor)          { window.mostrarToast("Informe o fornecedor.", "error"); return; }
  if (!descricao)           { window.mostrarToast("Informe a descrição.", "error"); return; }
  if (!total || total <= 0) { window.mostrarToast("Informe um total válido.", "error"); return; }
  if (!dataStr)             { window.mostrarToast("Informe a data.", "error"); return; }

  const btn = document.getElementById("btnSalvarComp");
  btn.disabled = true; btn.textContent = "Salvando...";

  try {
    await addDoc(collection(db, COL_COMPRAS), {
      fornecedor, descricao, total, nf, obs, forma, status,
      data: Timestamp.fromDate(new Date(dataStr + "T12:00:00")),
      vencimento: vencStr ? Timestamp.fromDate(new Date(vencStr + "T23:59:59")) : null,
      anexos: _anexosAtuais,
      criadoEm: serverTimestamp()
    });

    if (prodId && qtdEst > 0) {
      const prodSnap = await getDoc(doc(db, COL_PRODUTOS, prodId));
      if (prodSnap.exists()) {
        await updateDoc(doc(db, COL_PRODUTOS, prodId), {
          estoque: (prodSnap.data().estoque || 0) + qtdEst
        });
      }
    }

    window.fecharModal();
    _anexosAtuais = [];
    window.mostrarToast("Compra registrada com sucesso!", "success");
    carregarComprasPage();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao registrar compra.", "error");
    btn.disabled = false; btn.textContent = "Registrar Compra";
  }
}

async function abrirDetalheCompra(id) {
  try {
    const snap = await getDoc(doc(db, COL_COMPRAS, id));
    if (!snap.exists()) { window.mostrarToast("Compra não encontrada.", "error"); return; }
    const c = snap.data();
    const dt = c.data?.toDate?.() || new Date(c.data);
    const venc = c.vencimento?.toDate?.() || (c.vencimento ? new Date(c.vencimento) : null);

    const body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><span class="field-label">Fornecedor</span><p style="font-weight:600">${escHtml(c.fornecedor||"—")}</p></div>
        <div><span class="field-label">Nota Fiscal</span><p>${escHtml(c.nf||"—")}</p></div>
        <div style="grid-column:1/-1"><span class="field-label">Descrição</span><p>${escHtml(c.descricao||"—")}</p></div>
        <div><span class="field-label">Data</span><p>${isNaN(dt)?"—":dt.toLocaleDateString("pt-BR")}</p></div>
        <div><span class="field-label">Vencimento</span><p>${venc?venc.toLocaleDateString("pt-BR"):"—"}</p></div>
        <div><span class="field-label">Forma de Pagamento</span><p>${escHtml(c.forma||"—")}</p></div>
        <div><span class="field-label">Status</span><p>${badgeStatusCompra(c.status)}</p></div>
        <div style="grid-column:1/-1;background:var(--gray-50);border-radius:var(--radius-md);padding:12px 16px">
          <span class="field-label">Total</span>
          <p style="font-size:1.4em;font-weight:700;color:var(--blue-600);margin:4px 0 0">${formatarMoeda(c.total)}</p>
        </div>
        ${c.obs ? `<div style="grid-column:1/-1"><span class="field-label">Observações</span><p style="color:var(--gray-500)">${escHtml(c.obs)}</p></div>` : ""}
        ${(c.anexos && c.anexos.length) ? `<div style="grid-column:1/-1">
          <span class="field-label">Nota Fiscal (${c.anexos.length} anexo${c.anexos.length>1?"s":""})</span>
          <div class="anexos-preview-grid" style="margin-top:6px">
            ${c.anexos.map(a => a.tipo === "imagem"
              ? `<a href="${a.dados}" target="_blank" class="anexo-thumb"><img src="${a.dados}" alt="${escHtml(a.nome)}" /><small>${escHtml(a.nome)}</small></a>`
              : `<a href="${a.dados}" target="_blank" class="anexo-thumb"><div class="anexo-thumb__pdf">📄</div><small>${escHtml(a.nome)}</small></a>`
            ).join("")}
          </div>
        </div>` : ""}
      </div>`;

    window.abrirModal("Detalhes da Compra", body,
      `<button class="btn-ghost" onclick="window.fecharModal()">Fechar</button>`);
  } catch (err) {
    window.mostrarToast("Erro ao carregar compra.", "error");
  }
}

async function abrirModalPagarCompra(id) {
  window.abrirModal("Marcar como Pago",
    `<div style="padding:8px 0"><p>Confirmar pagamento desta compra?</p>
     <div><label class="field-label">Data do Pagamento</label>
     <input type="date" id="mDataPagComp" class="field-input--plain" value="${new Date().toISOString().split("T")[0]}" />
     </div></div>`,
    `<button class="btn-ghost" id="btnCancPagC">Cancelar</button>
     <button class="btn-primary" id="btnConfPagC">Confirmar Pagamento</button>`);
  document.getElementById("btnCancPagC").onclick = () => window.fecharModal();
  document.getElementById("btnConfPagC").onclick = async () => {
    const btn = document.getElementById("btnConfPagC");
    btn.disabled = true; btn.textContent = "Salvando...";
    try {
      const dataStr = document.getElementById("mDataPagComp").value;
      await updateDoc(doc(db, COL_COMPRAS, id), {
        status: "pago",
        dataPagamento: dataStr ? Timestamp.fromDate(new Date(dataStr + "T12:00:00")) : serverTimestamp()
      });
      window.fecharModal();
      window.mostrarToast("Compra marcada como paga!", "success");
      carregarComprasPage();
    } catch (err) {
      window.mostrarToast("Erro ao atualizar.", "error");
      btn.disabled = false; btn.textContent = "Confirmar Pagamento";
    }
  };
}

function confirmarExcluirCompra(id) {
  window.abrirModal("Excluir Compra",
    `<div class="delete-warning"><strong>⚠️ Confirmar exclusão</strong>Esta compra será removida permanentemente.</div>`,
    `<button class="btn-ghost" id="btnCancExcC">Cancelar</button>
     <button class="btn-danger" id="btnConfExcC">Excluir</button>`);
  document.getElementById("btnCancExcC").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcC").onclick = async () => {
    const btn = document.getElementById("btnConfExcC");
    btn.disabled = true; btn.textContent = "Excluindo...";
    try {
      await deleteDoc(doc(db, COL_COMPRAS, id));
      window.fecharModal();
      window.mostrarToast("Compra excluída.", "success");
      carregarComprasPage();
    } catch (err) {
      window.mostrarToast("Erro ao excluir.", "error");
      btn.disabled = false; btn.textContent = "Excluir";
    }
  };
}

async function exportarCompras() {
  try {
    const snap = await getDocs(query(collection(db, COL_COMPRAS), orderBy("data", "desc")));
    const linhas = [["Fornecedor","Descrição","Data","Vencimento","Forma Pagamento","Total","Status"]];
    snap.forEach(d => {
      const c = d.data();
      const dt   = c.data?.toDate?.() || new Date(c.data);
      const venc = c.vencimento?.toDate?.() || null;
      linhas.push([c.fornecedor||"", c.descricao||"", isNaN(dt)?"":dt.toLocaleDateString("pt-BR"), venc?venc.toLocaleDateString("pt-BR"):"", c.forma||"", c.total||0, c.status||""]);
    });
    const ok = exportarExcel(`compras_${new Date().toISOString().split("T")[0]}.xlsx`, linhas);
    if (ok) window.mostrarToast("Compras exportadas!", "success");
  } catch (err) { console.error(err); window.mostrarToast("Erro ao exportar.", "error"); }
}

function badgeStatusCompra(status, atrasado = false) {
  if (atrasado) return `<span style="display:inline-flex;padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;background:#FEE2E2;color:#991B1B">Atrasado</span>`;
  const map = {
    "pendente": { bg:"#FEF3C7", color:"#92400E", label:"Pendente" },
    "pago":     { bg:"#D1FAE5", color:"#065F46", label:"Pago" }
  };
  const s = map[status] || map["pendente"];
  return `<span style="display:inline-flex;padding:2px 8px;border-radius:9999px;font-size:0.7rem;font-weight:600;background:${s.bg};color:${s.color}">${s.label}</span>`;
}
