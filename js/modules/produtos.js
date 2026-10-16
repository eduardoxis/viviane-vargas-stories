// produtos.js — Módulo Produtos / Estoque — Gerência Viviane Vargas Stories
import {
  collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy, limit,
  serverTimestamp, Timestamp, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, formatarData, escHtml, exportarExcel } from "../utils/database.js";

const COL = "vv_produtos";
const COL_HIST = "vv_estoque_historico";
const COL_CUSTO_HIST = "vv_custo_historico";

// Grava uma linha no histórico de movimentações de estoque
async function gravarMovimentacao({ produtoId, nomeProduto, tipo, qtdAntes, qtdDepois, motivo, operador }) {
  try {
    await addDoc(collection(db, COL_HIST), {
      produtoId, nomeProduto,
      tipo,            // "entrada" | "saida" | "inventario" | "venda" | "importacao"
      qtdAntes:  qtdAntes  ?? 0,
      qtdDepois: qtdDepois ?? 0,
      delta:    (qtdDepois ?? 0) - (qtdAntes ?? 0),
      motivo:    motivo   || "",
      operador:  operador || "—",
      criadoEm:  serverTimestamp()
    });
  } catch (err) { console.error("Erro ao gravar movimentação:", err); }
}

// ── Histórico de preço de custo ──────────────────────────────
async function gravarHistoricoCusto({ produtoId, nomeProduto, custoAntes, custoDepois, precoVenda, motivo, operador }) {
  try {
    await addDoc(collection(db, COL_CUSTO_HIST), {
      produtoId, nomeProduto,
      custoAntes:  custoAntes  ?? 0,
      custoDepois: custoDepois ?? 0,
      precoVenda:  precoVenda  ?? 0,
      motivo:      motivo || "Alteração manual",
      operador:    operador || "—",
      criadoEm:    serverTimestamp()
    });
  } catch (err) { console.error("Erro ao gravar histórico de custo:", err); }
}

// ── Margem de lucro ───────────────────────────────────────────
function calcularMargem(preco, custo) {
  const p = preco || 0, c = custo || 0;
  const margemReais = p - c;
  const margemPct = p > 0 ? (margemReais / p) * 100 : 0;
  return { margemReais, margemPct };
}

function corMargem(pct) {
  if (pct < 10)  return { cor: "#991B1B", bg: "#FEE2E2" }; // vermelho — margem apertada/negativa
  if (pct < 30)  return { cor: "#92400E", bg: "#FEF3C7" }; // amarelo — atenção
  return { cor: "#065F46", bg: "#D1FAE5" };                 // verde — saudável
}

// ── Custos e margem de lucro (por unidade) ────────────────────
// Impostos e taxas incidem sobre o preço de venda. O markup é calculado sobre
// o custo total (custo do produto + outros gastos).
function calcularFinanceiro({ preco, custo, outros, impostosPct, taxasPct, estoque }) {
  const p = Number(preco) || 0, c = Number(custo) || 0, o = Number(outros) || 0;
  const imp = Number(impostosPct) || 0, tx = Number(taxasPct) || 0, est = Number(estoque) || 0;
  const impostos = p * imp / 100;
  const taxas    = p * tx / 100;
  const lucro    = p - c - o - impostos - taxas;
  const margemPct = p > 0 ? (lucro / p) * 100 : 0;
  const base      = c + o;
  const markupPct = base > 0 ? (lucro / base) * 100 : null;
  const denom     = 1 - (imp + tx) / 100;
  const precoMinimo = denom > 0 ? base / denom : null;
  return { preco: p, custo: c, outros: o, impostos, taxas, lucro, margemPct, markupPct, precoMinimo, estoque: est, lucroEstoque: lucro * est };
}

function fmtPct(v, casas = 1) {
  return `${(Number(v) || 0).toFixed(casas).replace(".", ",")}%`;
}

function rotuloMargem(pct) {
  if (pct < 0)  return "Prejuízo";
  if (pct < 10) return "Margem apertada";
  if (pct < 30) return "Margem razoável";
  return "Margem boa";
}

function htmlPainelMargem(p = {}) {
  return `
      <div class="prod-margem-painel">
        <div class="prod-margem-titulo">Custos e margem de lucro</div>
        <p class="prod-margem-sub">Preencha o que se aplica ao produto (por unidade) para calcular o lucro e a margem. O preço de venda e o custo do produto são os campos acima.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div>
            <label class="field-label">Outros gastos (R$)</label>
            <input type="number" id="mProdOutros" class="field-input--plain" placeholder="0,00" min="0" step="0.01" value="${p.outrosGastos || ""}" />
          </div>
          <div>
            <label class="field-label">Impostos (% da venda)</label>
            <input type="number" id="mProdImpostos" class="field-input--plain" placeholder="0" min="0" max="100" step="0.01" value="${p.impostosPct || ""}" />
          </div>
          <div>
            <label class="field-label">Taxas de pagamento (%)</label>
            <input type="number" id="mProdTaxas" class="field-input--plain" placeholder="0" min="0" max="100" step="0.01" value="${p.taxasPct || ""}" />
          </div>
        </div>
        <div id="prodMargemResultado"></div>
      </div>`;
}

// Liga o painel: recalcula a cada digitação. getEstoque() devolve a quantidade em estoque.
function ligarPainelMargem(getEstoque) {
  const ids = ["mProdPreco", "mProdCusto", "mProdOutros", "mProdImpostos", "mProdTaxas", "mProdEstoque"];
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;

  const atualizar = () => {
    const box = document.getElementById("prodMargemResultado");
    if (!box) return;
    const r = calcularFinanceiro({
      preco: num("mProdPreco"), custo: num("mProdCusto"), outros: num("mProdOutros"),
      impostosPct: num("mProdImpostos"), taxasPct: num("mProdTaxas"), estoque: getEstoque()
    });
    if (r.preco <= 0) {
      box.innerHTML = `<p class="prod-margem-sub" style="margin:12px 0 0">Informe o preço de venda para calcular.</p>`;
      return;
    }
    const cm = corMargem(r.margemPct);
    const neg = v => `−${formatarMoeda(v)}`;
    const linha = (rot, val) => `<div class="prod-margem-linha"><span>${rot}</span><span>${val}</span></div>`;
    box.innerHTML = `
      <div class="prod-margem-resumo">
        ${linha("Preço de venda", formatarMoeda(r.preco))}
        ${linha("Custo do produto", neg(r.custo))}
        ${linha("Outros gastos", neg(r.outros))}
        ${linha("Impostos", neg(r.impostos))}
        ${linha("Taxas", neg(r.taxas))}
      </div>
      <div class="prod-margem-destaque" style="background:${cm.bg}">
        <div><span style="color:${cm.cor}">Lucro por unidade</span><strong style="color:${cm.cor}">${formatarMoeda(r.lucro)}</strong></div>
        <div><span style="color:${cm.cor}">Margem de lucro</span><strong style="color:${cm.cor}">${fmtPct(r.margemPct)}</strong></div>
        <div><span style="color:${cm.cor}">Markup (sobre o custo)</span><strong style="color:${cm.cor}">${r.markupPct === null ? "—" : fmtPct(r.markupPct)}</strong></div>
      </div>
      <span class="prod-margem-badge" style="background:${cm.bg};color:${cm.cor}">${rotuloMargem(r.margemPct)}</span>
      <div class="prod-margem-rodape">
        <div>Preço mínimo para não ter prejuízo: <strong>${r.precoMinimo === null ? "—" : formatarMoeda(r.precoMinimo)}</strong></div>
        <div>Lucro potencial do estoque (${r.estoque} un.): <strong>${formatarMoeda(r.lucroEstoque)}</strong></div>
      </div>`;
  };

  ids.forEach(id => document.getElementById(id)?.addEventListener("input", atualizar));
  atualizar();
}

// ── Código de barras (EAN-13 de uso interno, prefixo 2xx) ─────
function calcularDigitoVerificadorEAN13(doze) {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(doze[i], 10) * (i % 2 === 0 ? 1 : 3);
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function gerarCodigoEAN13(seed) {
  const str = String(seed || "") + Date.now() + Math.random();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  const onze = String(hash).padStart(11, "0").slice(-11);
  const doze = "2" + onze; // prefixo 2 = faixa reservada para uso interno (não-GS1)
  const dv = calcularDigitoVerificadorEAN13(doze);
  return doze + String(dv);
}

let _dadosUsuario = null;
let _fotoAtual = null; // base64 da foto sendo editada no modal (null = sem foto)

// ── Foto do produto: seleciona, redimensiona (canvas) e prepara preview ──
function redimensionarImagem(file, maxLado = 200, qualidade = 0.82) {
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

function renderFotoPreview(fotoBase64) {
  const preview = document.getElementById("prodFotoPreview");
  const btnRemover = document.getElementById("btnRemoverFoto");
  if (fotoBase64) {
    preview.innerHTML = `<img src="${fotoBase64}" alt="Foto do produto" />`;
    if (btnRemover) btnRemover.hidden = false;
  } else {
    preview.innerHTML = "📦";
    if (btnRemover) btnRemover.hidden = true;
  }
}

function ligarUploadFoto(fotoExistente) {
  _fotoAtual = fotoExistente || null;
  renderFotoPreview(_fotoAtual);

  document.getElementById("btnEscolherFoto").onclick = () => document.getElementById("mProdFotoInput").click();
  document.getElementById("mProdFotoInput").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { window.mostrarToast("Selecione um arquivo de imagem.", "error"); return; }
    try {
      _fotoAtual = await redimensionarImagem(file);
      renderFotoPreview(_fotoAtual);
    } catch (err) {
      console.error(err);
      window.mostrarToast("Não foi possível processar a imagem.", "error");
    }
  };
  document.getElementById("btnRemoverFoto").onclick = () => {
    _fotoAtual = null;
    renderFotoPreview(null);
  };
}

export function iniciarProdutos(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "produtos") carregarProdutosPage();
  });

  document.getElementById("btnNovoProduto")?.addEventListener("click", abrirModalNovoProduto);

  document.getElementById("btnBuscarProdutos")?.addEventListener("click", () => {
    const t = document.getElementById("filtroBuscaProdutos").value.trim();
    const c = document.getElementById("filtroCatProdutos").value;
    carregarListaProdutos(t, c);
  });

  document.getElementById("btnLimparBuscaProdutos")?.addEventListener("click", () => {
    document.getElementById("filtroBuscaProdutos").value = "";
    document.getElementById("filtroCatProdutos").value = "todos";
    carregarListaProdutos();
  });

  document.getElementById("filtroBuscaProdutos")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      carregarListaProdutos(e.target.value.trim(), document.getElementById("filtroCatProdutos").value);
    }
  });

  document.getElementById("tbodyProdutos")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "editar-produto") abrirModalEditarProduto(id);
    if (action === "excluir-produto") confirmarExcluirProduto(id);
    if (action === "historico-estoque") abrirHistoricoEstoque(id);
    if (action === "ajustar-estoque") abrirModalAjusteEstoque(id);
    if (action === "historico-custo") abrirHistoricoCusto(id);
    if (action === "codigo-barras") abrirModalCodigoBarras(id);
  });

  document.getElementById("btnExportarProdutos")?.addEventListener("click", exportarProdutos);

  document.getElementById("btnHistoricoGeralEstoque")?.addEventListener("click", abrirHistoricoGeralEstoque);

  document.getElementById("btnImportarProdutos")?.addEventListener("click", () => {
    document.getElementById("inputImportarProdutos")?.click();
  });
  document.getElementById("inputImportarProdutos")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importarProdutos(file);
  });
}

async function carregarProdutosPage() {
  await carregarListaProdutos();
  atualizarIndicadoresProdutos();
}

async function atualizarIndicadoresProdutos() {
  try {
    const snap = await getDocs(collection(db, COL));
    let totalProdutos = 0, totalEstoque = 0, valorInventario = 0, abaixoMinimo = 0;
    snap.forEach(d => {
      const p = d.data();
      totalProdutos++;
      totalEstoque += p.estoque || 0;
      valorInventario += (p.preco || 0) * (p.estoque || 0);
      if ((p.estoqueMinimo || 0) > 0 && (p.estoque || 0) <= (p.estoqueMinimo || 0)) abaixoMinimo++;
    });
    const el = id => document.getElementById(id);
    if (el("indTotalProdutos"))   el("indTotalProdutos").textContent   = totalProdutos;
    if (el("indTotalEstoque"))    el("indTotalEstoque").textContent    = totalEstoque;
    if (el("indValorInventario")) el("indValorInventario").textContent = formatarMoeda(valorInventario);
    if (el("indAbaixoMinimo"))    el("indAbaixoMinimo").textContent    = abaixoMinimo;
  } catch (err) { console.error(err); }
}

async function carregarListaProdutos(busca = "", categoria = "todos") {
  const tbody = document.getElementById("tbodyProdutos");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Carregando produtos...</td></tr>`;

  try {
    const snap = await getDocs(query(collection(db, COL), orderBy("nome")));
    let produtos = [];
    snap.forEach(d => produtos.push({ id: d.id, ...d.data() }));

    if (busca) {
      const t = busca.toLowerCase();
      produtos = produtos.filter(p => p.nome?.toLowerCase().includes(t) || p.codigo?.toLowerCase().includes(t));
    }
    if (categoria !== "todos") {
      produtos = produtos.filter(p => p.categoria === categoria);
    }

    if (!produtos.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">Nenhum produto encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = produtos.map(p => {
      const estoque = p.estoque || 0;
      const min = p.estoqueMinimo || 0;
      const alertaEstoque = min > 0 && estoque <= min;
      const estoqueHtml = alertaEstoque
        ? `<span style="color:#DC2626;font-weight:600">${estoque} ⚠️</span>`
        : `<span style="color:var(--gray-700)">${estoque}</span>`;
      const fin = calcularFinanceiro({ preco: p.preco, custo: p.precoCusto, outros: p.outrosGastos, impostosPct: p.impostosPct, taxasPct: p.taxasPct, estoque: p.estoque });
      const margemReais = fin.lucro, margemPct = fin.margemPct;
      const cm = corMargem(margemPct);
      const margemHtml = (p.precoCusto || 0) > 0
        ? `<span title="${formatarMoeda(margemReais)} por unidade" style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:var(--text-xs);font-weight:600;white-space:nowrap;background:${cm.bg};color:${cm.cor}">${margemPct.toFixed(0)}%</span>`
        : `<span style="color:var(--gray-400);font-size:var(--text-xs)">—</span>`;

      return `<tr>
        <td><span style="font-size:0.7rem;color:var(--gray-400);font-family:monospace">${escHtml(p.codigo || "—")}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="prod-thumb-mini">${p.foto ? `<img src="${p.foto}" alt="">` : "📦"}</div>
            <strong style="color:var(--gray-800)">${escHtml(p.nome)}</strong>
          </div>
        </td>
        <td style="color:var(--gray-500);font-size:var(--text-sm)">${escHtml(p.categoria || "—")}</td>
        <td>${formatarMoeda(p.preco || 0)}</td>
        <td>${formatarMoeda(p.precoCusto || 0)}</td>
        <td>${margemHtml}</td>
        <td>${estoqueHtml}</td>
        <td style="color:var(--gray-400);font-size:var(--text-sm)">${p.unidade || "un"}</td>
        <td><span style="font-size:0.7rem;color:var(--gray-400);font-family:monospace">${escHtml(p.codigoBarras || "—")}</span></td>
        <td class="col-center" style="white-space:nowrap">
          <button class="btn-table-action btn-table-action--view" data-action="codigo-barras" data-id="${p.id}" title="Código de barras">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h1a1 1 0 011 1v14a1 1 0 01-1 1H3a1 1 0 01-1-1V3zM6 3a1 1 0 011-1 1 1 0 011 1v14a1 1 0 01-1 1 1 1 0 01-1-1V3zM9.5 2a1 1 0 00-1 1v14a1 1 0 002 0V3a1 1 0 00-1-1zM12 3a1 1 0 011-1h1a1 1 0 011 1v14a1 1 0 01-1 1h-1a1 1 0 01-1-1V3zM17 2a1 1 0 00-1 1v14a1 1 0 002 0V3a1 1 0 00-1-1z"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--view" data-action="historico-custo" data-id="${p.id}" title="Histórico de custo e margem">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clip-rule="evenodd"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--view" data-action="historico-estoque" data-id="${p.id}" title="Histórico de movimentações">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--view" data-action="ajustar-estoque" data-id="${p.id}" title="Ajustar estoque">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--view" data-action="editar-produto" data-id="${p.id}" title="Editar">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
          <button class="btn-table-action btn-table-action--delete" data-action="excluir-produto" data-id="${p.id}" title="Excluir">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </td>
      </tr>`;
    }).join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">Erro ao carregar produtos.</td></tr>`;
  }
}

function abrirModalNovoProduto() {
  const body = `
    <div class="form-usuario">
      <div class="prod-foto-row">
        <div class="prod-foto-preview" id="prodFotoPreview">📦</div>
        <div class="prod-foto-actions">
          <label class="field-label">Foto do Produto</label>
          <input type="file" id="mProdFotoInput" accept="image/*" hidden />
          <div style="display:flex;gap:8px">
            <button type="button" class="btn-ghost" id="btnEscolherFoto">Escolher imagem</button>
            <button type="button" class="btn-ghost" id="btnRemoverFoto" hidden>Remover</button>
          </div>
          <small style="color:var(--gray-400)">A imagem é redimensionada automaticamente (até 200×200px) e aparece no Caixa.</small>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Nome do Produto *</label>
          <input type="text" id="mProdNome" class="field-input--plain" placeholder="Ex: Fone de ouvido Bluetooth" autocomplete="off" />
        </div>
        <div>
          <label class="field-label">Código / SKU</label>
          <input type="text" id="mProdCodigo" class="field-input--plain" placeholder="Ex: FON-001" />
        </div>
      </div>
      <div>
        <label class="field-label">Categoria</label>
        <input type="text" id="mProdCategoria" class="field-input--plain" placeholder="Ex: Acessórios, Eletrônicos, Casa e Decoração..." list="listaCategorias" />
        <datalist id="listaCategorias">
          <option value="Acessórios"/>
          <option value="Eletrônicos"/>
          <option value="Casa e Decoração"/>
          <option value="Papelaria"/>
          <option value="Brinquedos"/>
          <option value="Vestuário"/>
          <option value="Beleza e Cuidados"/>
          <option value="Utilidades"/>
          <option value="Presentes"/>
          <option value="Outros"/>
        </datalist>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Preço de Venda (R$) *</label>
          <input type="number" id="mProdPreco" class="field-input--plain" placeholder="0,00" min="0" step="0.01" />
        </div>
        <div>
          <label class="field-label">Preço de Custo (R$)</label>
          <input type="number" id="mProdCusto" class="field-input--plain" placeholder="0,00" min="0" step="0.01" />
        </div>
        <div>
          <label class="field-label">Unidade</label>
          <select id="mProdUnidade" class="field-input--plain">
            <option value="un">Unidade (un)</option>
            <option value="kg">Quilograma (kg)</option>
            <option value="g">Grama (g)</option>
            <option value="L">Litro (L)</option>
            <option value="ml">Mililitro (ml)</option>
            <option value="cx">Caixa (cx)</option>
            <option value="pct">Pacote (pct)</option>
            <option value="dz">Dúzia (dz)</option>
          </select>
        </div>
      </div>
      ${htmlPainelMargem()}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Estoque Inicial</label>
          <input type="number" id="mProdEstoque" class="field-input--plain" placeholder="0" min="0" step="1" value="0" />
        </div>
        <div>
          <label class="field-label">Estoque Mínimo (alerta)</label>
          <input type="number" id="mProdEstoqueMin" class="field-input--plain" placeholder="0" min="0" step="1" value="0" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label class="field-label">Código de Barras</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="mProdCodBarras" class="field-input--plain" placeholder="Ex: 7891234567890" inputmode="numeric" style="flex:1" />
            <button type="button" class="btn-ghost" id="btnGerarCodBarras" title="Gerar código automaticamente">Gerar</button>
          </div>
        </div>
        <div>
          <label class="field-label">Observações</label>
          <input type="text" id="mProdObs" class="field-input--plain" placeholder="Informações adicionais..." />
        </div>
      </div>
    </div>`;

  const footer = `
    <button class="btn-ghost" id="btnCancelarModalProd">Cancelar</button>
    <button class="btn-primary" id="btnSalvarProduto">Salvar Produto</button>`;

  window.abrirModal("Novo Produto", body, footer);
  document.getElementById("btnCancelarModalProd").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarProduto").onclick = salvarNovoProduto;
  document.getElementById("btnGerarCodBarras").onclick = () => {
    const nomeAtual = document.getElementById("mProdNome").value.trim() || "produto";
    document.getElementById("mProdCodBarras").value = gerarCodigoEAN13(nomeAtual);
  };
  document.getElementById("mProdNome").focus();
  ligarUploadFoto(null);
  ligarPainelMargem(() => parseInt(document.getElementById("mProdEstoque").value) || 0);
}

async function salvarNovoProduto() {
  const nome = document.getElementById("mProdNome").value.trim();
  if (!nome) { window.mostrarToast("Informe o nome do produto.", "error"); return; }

  const preco = parseFloat(document.getElementById("mProdPreco").value);
  if (!preco || preco < 0) { window.mostrarToast("Informe um preço de venda válido.", "error"); return; }

  const btn = document.getElementById("btnSalvarProduto");
  btn.disabled = true; btn.textContent = "Salvando...";

  try {
    const precoCusto = parseFloat(document.getElementById("mProdCusto").value) || 0;
    const novoRef = await addDoc(collection(db, COL), {
      nome,
      foto:          _fotoAtual || null,
      codigo:        document.getElementById("mProdCodigo").value.trim(),
      codigoBarras:  document.getElementById("mProdCodBarras").value.trim(),
      categoria:     document.getElementById("mProdCategoria").value.trim(),
      preco,
      precoCusto,
      unidade:       document.getElementById("mProdUnidade").value,
      estoque:       parseInt(document.getElementById("mProdEstoque").value) || 0,
      estoqueMinimo: parseInt(document.getElementById("mProdEstoqueMin").value) || 0,
      outrosGastos:  parseFloat(document.getElementById("mProdOutros").value) || 0,
      impostosPct:   parseFloat(document.getElementById("mProdImpostos").value) || 0,
      taxasPct:      parseFloat(document.getElementById("mProdTaxas").value) || 0,
      observacoes:   document.getElementById("mProdObs").value.trim(),
      criadoEm:      serverTimestamp()
    });
    if (precoCusto > 0) {
      gravarHistoricoCusto({
        produtoId: novoRef.id, nomeProduto: nome,
        custoAntes: 0, custoDepois: precoCusto, precoVenda: preco,
        motivo: "Cadastro do produto", operador: _dadosUsuario?.nome || "—"
      });
    }
    window.fecharModal();
    window.mostrarToast("Produto cadastrado com sucesso!", "success");
    carregarListaProdutos();
    atualizarIndicadoresProdutos();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao salvar produto.", "error");
    btn.disabled = false; btn.textContent = "Salvar Produto";
  }
}

async function abrirModalEditarProduto(id) {
  try {
    const snap = await getDoc(doc(db, COL, id));
    if (!snap.exists()) { window.mostrarToast("Produto não encontrado.", "error"); return; }
    const p = snap.data();

    const body = `
      <div class="form-usuario">
        <div class="prod-foto-row">
          <div class="prod-foto-preview" id="prodFotoPreview">${p.foto ? `<img src="${p.foto}" alt="Foto do produto" />` : "📦"}</div>
          <div class="prod-foto-actions">
            <label class="field-label">Foto do Produto</label>
            <input type="file" id="mProdFotoInput" accept="image/*" hidden />
            <div style="display:flex;gap:8px">
              <button type="button" class="btn-ghost" id="btnEscolherFoto">Escolher imagem</button>
              <button type="button" class="btn-ghost" id="btnRemoverFoto" ${p.foto ? "" : "hidden"}>Remover</button>
            </div>
            <small style="color:var(--gray-400)">A imagem é redimensionada automaticamente (até 200×200px) e aparece no Caixa.</small>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="field-label">Nome do Produto *</label>
            <input type="text" id="mProdNome" class="field-input--plain" value="${escHtml(p.nome || "")}" />
          </div>
          <div>
            <label class="field-label">Código / SKU</label>
            <input type="text" id="mProdCodigo" class="field-input--plain" value="${escHtml(p.codigo || "")}" />
          </div>
        </div>
        <div>
          <label class="field-label">Categoria</label>
          <input type="text" id="mProdCategoria" class="field-input--plain" value="${escHtml(p.categoria || "")}" list="listaCategorias2" />
          <datalist id="listaCategorias2">
            <option value="Acessórios"/><option value="Eletrônicos"/><option value="Casa e Decoração"/>
            <option value="Papelaria"/><option value="Brinquedos"/><option value="Vestuário"/>
            <option value="Beleza e Cuidados"/><option value="Utilidades"/><option value="Presentes"/><option value="Outros"/>
          </datalist>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div>
            <label class="field-label">Preço de Venda (R$) *</label>
            <input type="number" id="mProdPreco" class="field-input--plain" value="${p.preco || 0}" min="0" step="0.01" />
          </div>
          <div>
            <label class="field-label">Preço de Custo (R$)</label>
            <input type="number" id="mProdCusto" class="field-input--plain" value="${p.precoCusto || 0}" min="0" step="0.01" />
          </div>
          <div>
            <label class="field-label">Unidade</label>
            <select id="mProdUnidade" class="field-input--plain">
              ${["un","kg","g","L","ml","cx","pct","dz"].map(u => `<option value="${u}" ${p.unidade===u?"selected":""}>${u}</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="prodMargemInfo" style="font-size:var(--text-xs);color:var(--gray-500)"></div>
        ${htmlPainelMargem(p)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label class="field-label">Código de Barras</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="mProdCodBarras" class="field-input--plain" value="${escHtml(p.codigoBarras || "")}" inputmode="numeric" style="flex:1" />
              <button type="button" class="btn-ghost" id="btnGerarCodBarras" title="Gerar código automaticamente">Gerar</button>
            </div>
          </div>
          <div>
            <label class="field-label">Estoque Mínimo (alerta)</label>
            <input type="number" id="mProdEstoqueMin" class="field-input--plain" value="${p.estoqueMinimo || 0}" min="0" />
          </div>
        </div>
        <div>
          <label class="field-label">Observações</label>
          <input type="text" id="mProdObs" class="field-input--plain" value="${escHtml(p.observacoes || "")}" />
        </div>
        <p style="font-size:var(--text-xs);color:var(--gray-400)">Para ajustar o estoque, use o botão de ajuste na tabela.</p>
      </div>`;

    const footer = `
      <button class="btn-ghost" id="btnCancelarModalProd">Cancelar</button>
      <button class="btn-primary" id="btnSalvarEditProduto">Salvar Alterações</button>`;

    window.abrirModal("Editar Produto", body, footer);
    document.getElementById("btnCancelarModalProd").onclick = () => window.fecharModal();
    document.getElementById("btnSalvarEditProduto").onclick = () => salvarEdicaoProduto(id);
    document.getElementById("btnGerarCodBarras").onclick = () => {
      document.getElementById("mProdCodBarras").value = gerarCodigoEAN13(p.nome || id);
    };
    ligarUploadFoto(p.foto || null);
    ligarPainelMargem(() => p.estoque || 0);

    const atualizarMargemInfo = () => {
      const num = id => parseFloat(document.getElementById(id).value) || 0;
      const fin = calcularFinanceiro({
        preco: num("mProdPreco"), custo: num("mProdCusto"), outros: num("mProdOutros"),
        impostosPct: num("mProdImpostos"), taxasPct: num("mProdTaxas"), estoque: p.estoque || 0
      });
      const custo = fin.custo, margemReais = fin.lucro, margemPct = fin.margemPct;
      const info = document.getElementById("prodMargemInfo");
      if (!info) return;
      const texto = custo > 0
        ? `Margem atual: <strong style="color:${corMargem(margemPct).cor}">${formatarMoeda(margemReais)} (${margemPct.toFixed(1)}%)</strong>`
        : `Informe o preço de custo para calcular a margem.`;
      info.innerHTML = `${texto} · <a href="#" id="lnkHistCusto" style="color:var(--blue-600)">Ver histórico de custo</a>`;
      document.getElementById("lnkHistCusto").onclick = (e) => { e.preventDefault(); abrirHistoricoCusto(id); };
    };
    atualizarMargemInfo();
    document.getElementById("mProdPreco").addEventListener("input", atualizarMargemInfo);
    document.getElementById("mProdCusto").addEventListener("input", atualizarMargemInfo);
    ["mProdOutros", "mProdImpostos", "mProdTaxas"].forEach(id => document.getElementById(id).addEventListener("input", atualizarMargemInfo));
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao carregar produto.", "error");
  }
}

async function salvarEdicaoProduto(id) {
  const nome = document.getElementById("mProdNome").value.trim();
  if (!nome) { window.mostrarToast("Informe o nome.", "error"); return; }

  const btn = document.getElementById("btnSalvarEditProduto");
  btn.disabled = true; btn.textContent = "Salvando...";

  try {
    const novoCusto = parseFloat(document.getElementById("mProdCusto").value) || 0;
    const novoPreco = parseFloat(document.getElementById("mProdPreco").value) || 0;

    const snapAntes = await getDoc(doc(db, COL, id));
    const custoAntes = snapAntes.exists() ? (snapAntes.data().precoCusto || 0) : 0;

    await updateDoc(doc(db, COL, id), {
      nome,
      foto:          _fotoAtual || null,
      codigo:        document.getElementById("mProdCodigo").value.trim(),
      codigoBarras:  document.getElementById("mProdCodBarras").value.trim(),
      categoria:     document.getElementById("mProdCategoria").value.trim(),
      preco:         novoPreco,
      precoCusto:    novoCusto,
      unidade:       document.getElementById("mProdUnidade").value,
      estoqueMinimo: parseInt(document.getElementById("mProdEstoqueMin").value) || 0,
      outrosGastos:  parseFloat(document.getElementById("mProdOutros").value) || 0,
      impostosPct:   parseFloat(document.getElementById("mProdImpostos").value) || 0,
      taxasPct:      parseFloat(document.getElementById("mProdTaxas").value) || 0,
      observacoes:   document.getElementById("mProdObs").value.trim()
    });

    if (Math.abs(novoCusto - custoAntes) >= 0.01) {
      gravarHistoricoCusto({
        produtoId: id, nomeProduto: nome,
        custoAntes, custoDepois: novoCusto, precoVenda: novoPreco,
        motivo: "Edição de produto", operador: _dadosUsuario?.nome || "—"
      });
    }

    window.fecharModal();
    window.mostrarToast("Produto atualizado!", "success");
    carregarListaProdutos();
    atualizarIndicadoresProdutos();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao salvar.", "error");
    btn.disabled = false; btn.textContent = "Salvar Alterações";
  }
}

async function abrirModalAjusteEstoque(id) {
  try {
    const snap = await getDoc(doc(db, COL, id));
    if (!snap.exists()) return;
    const p = snap.data();

    const body = `
      <div class="form-usuario">
        <p style="font-weight:600;color:var(--gray-800);margin-bottom:4px">${escHtml(p.nome)}</p>
        <p style="font-size:var(--text-sm);color:var(--gray-500);margin-bottom:16px">Estoque atual: <strong>${p.estoque || 0} ${p.unidade || "un"}</strong></p>
        <div>
          <label class="field-label">Tipo de Ajuste</label>
          <select id="mAjusteTipo" class="field-input--plain">
            <option value="entrada">Entrada (adicionar ao estoque)</option>
            <option value="saida">Saída (retirar do estoque)</option>
            <option value="inventario">Inventário (definir quantidade exata)</option>
          </select>
        </div>
        <div>
          <label class="field-label">Quantidade *</label>
          <input type="number" id="mAjusteQtd" class="field-input--plain" placeholder="0" min="0" step="1" />
        </div>
        <div>
          <label class="field-label">Motivo</label>
          <input type="text" id="mAjusteMotivo" class="field-input--plain" placeholder="Ex: Compra de fornecedor, ajuste de inventário..." />
        </div>
      </div>`;

    const footer = `
      <button class="btn-ghost" id="btnCancelarModalProd">Cancelar</button>
      <button class="btn-primary" id="btnConfirmarAjuste">Confirmar Ajuste</button>`;

    window.abrirModal("Ajuste de Estoque", body, footer);
    document.getElementById("btnCancelarModalProd").onclick = () => window.fecharModal();
    document.getElementById("btnConfirmarAjuste").onclick = () => confirmarAjusteEstoque(id, p.estoque || 0);
    document.getElementById("mAjusteQtd").focus();
  } catch (err) {
    window.mostrarToast("Erro ao abrir ajuste.", "error");
  }
}

async function confirmarAjusteEstoque(id, estoqueAtual) {
  const tipo = document.getElementById("mAjusteTipo").value;
  const qtd  = parseInt(document.getElementById("mAjusteQtd").value);
  const motivo = document.getElementById("mAjusteMotivo").value.trim();

  if (!qtd || qtd < 0) { window.mostrarToast("Informe uma quantidade válida.", "error"); return; }

  let novoEstoque;
  if (tipo === "entrada")    novoEstoque = estoqueAtual + qtd;
  else if (tipo === "saida") novoEstoque = Math.max(0, estoqueAtual - qtd);
  else                       novoEstoque = qtd; // inventário

  const btn = document.getElementById("btnConfirmarAjuste");
  btn.disabled = true; btn.textContent = "Salvando...";

  try {
    const snap = await getDoc(doc(db, COL, id));
    const nomeProduto = snap.exists() ? (snap.data().nome || "—") : "—";

    await updateDoc(doc(db, COL, id), { estoque: novoEstoque });

    await gravarMovimentacao({
      produtoId: id,
      nomeProduto,
      tipo,
      qtdAntes: estoqueAtual,
      qtdDepois: novoEstoque,
      motivo: motivo || (tipo === "entrada" ? "Entrada manual" : tipo === "saida" ? "Saída manual" : "Inventário"),
      operador: _dadosUsuario?.nome || "—"
    });

    window.fecharModal();
    window.mostrarToast(`Estoque atualizado para ${novoEstoque}!`, "success");
    carregarListaProdutos();
    atualizarIndicadoresProdutos();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao ajustar estoque.", "error");
    btn.disabled = false; btn.textContent = "Confirmar Ajuste";
  }
}

// ── Histórico de movimentações de estoque ───────────────────
async function abrirHistoricoEstoque(id) {
  const snap = await getDoc(doc(db, COL, id)).catch(() => null);
  const nomeProd = snap?.exists() ? (snap.data().nome || "—") : "—";

  window.abrirModal(`Histórico — ${nomeProd}`,
    `<p class="loading-cell" style="padding:20px">Carregando movimentações...</p>`,
    `<button class="btn-ghost" id="btnFechHistEst">Fechar</button>`);
  document.getElementById("btnFechHistEst").onclick = () => window.fecharModal();

  try {
    const histSnap = await getDocs(
      query(collection(db, COL_HIST),
        where("produtoId", "==", id),
        orderBy("criadoEm", "desc"),
        limit(100))
    );

    if (histSnap.empty) {
      window.abrirModal(`Histórico — ${nomeProd}`,
        `<p class="empty-cell">Nenhuma movimentação registrada para este produto.</p>`,
        `<button class="btn-ghost" id="btnFechHistEst2">Fechar</button>`);
      document.getElementById("btnFechHistEst2").onclick = () => window.fecharModal();
      return;
    }

    const LABELS = {
      entrada:    { txt: "Entrada",    cor: "#065F46", bg: "#D1FAE5" },
      saida:      { txt: "Saída",      cor: "#991B1B", bg: "#FEE2E2" },
      inventario: { txt: "Inventário", cor: "#92704D", bg: "#F7EEDF" },
      venda:      { txt: "Venda",      cor: "#92400E", bg: "#FEF3C7" },
      importacao: { txt: "Importação", cor: "#5B21B6", bg: "#EDE9FE" },
    };

    const linhas = histSnap.docs.map(d => {
      const m = d.data();
      const dt = m.criadoEm?.toDate?.() || new Date();
      const l = LABELS[m.tipo] || { txt: m.tipo, cor: "#374151", bg: "#F3F4F6" };
      const delta = m.delta ?? (m.qtdDepois - m.qtdAntes);
      const sinal = delta > 0 ? `+${delta}` : `${delta}`;
      const corDelta = delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--gray-400)";
      return `<tr>
        <td style="font-size:var(--text-xs);color:var(--gray-400);white-space:nowrap">
          ${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
        </td>
        <td>
          <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:${l.bg};color:${l.cor}">${l.txt}</span>
        </td>
        <td style="text-align:center;font-weight:600;color:${corDelta}">${sinal}</td>
        <td style="text-align:center;color:var(--gray-500)">${m.qtdAntes ?? "—"}</td>
        <td style="text-align:center;font-weight:700">${m.qtdDepois ?? "—"}</td>
        <td style="font-size:var(--text-xs);color:var(--gray-500)">${escHtml(m.motivo || "—")}</td>
        <td style="font-size:var(--text-xs);color:var(--gray-400)">${escHtml(m.operador || "—")}</td>
      </tr>`;
    }).join("");

    const body = `
      <div class="table-wrap" style="max-height:440px;overflow:auto">
        <table class="data-table" style="font-size:var(--text-xs)">
          <thead>
            <tr>
              <th>Data/Hora</th><th>Tipo</th><th style="text-align:center">Δ Qtd</th>
              <th style="text-align:center">Antes</th><th style="text-align:center">Depois</th>
              <th>Motivo</th><th>Operador</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;

    window.abrirModal(`Histórico — ${nomeProd}`, body,
      `<button class="btn-ghost" id="btnExportHistEst">
         <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
         Exportar Excel
       </button>
       <button class="btn-ghost" id="btnFechHistEst3">Fechar</button>`);
    document.getElementById("btnFechHistEst3").onclick = () => window.fecharModal();
    document.getElementById("btnExportHistEst").onclick = () => {
      const cabAlhas = [["Data/Hora","Tipo","Delta","Antes","Depois","Motivo","Operador"]];
      const rows = histSnap.docs.map(d => {
        const m = d.data();
        const dt = m.criadoEm?.toDate?.() || new Date();
        const delta = m.delta ?? (m.qtdDepois - m.qtdAntes);
        return [
          `${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`,
          LABELS[m.tipo]?.txt || m.tipo, delta >= 0 ? `+${delta}` : `${delta}`,
          m.qtdAntes ?? "", m.qtdDepois ?? "", m.motivo || "", m.operador || ""
        ];
      });
      exportarExcel(`historico_${nomeProd.replace(/\s+/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`,
        [...cabAlhas, ...rows]);
    };
  } catch (err) {
    console.error(err);
    window.abrirModal(`Histórico — ${nomeProd}`,
      `<p class="empty-cell">Erro ao carregar histórico.</p>`,
      `<button class="btn-ghost" id="btnFechHistEst4">Fechar</button>`);
    document.getElementById("btnFechHistEst4").onclick = () => window.fecharModal();
  }
}

// ── Histórico de Custo / Margem ───────────────────────────────
async function abrirHistoricoCusto(id) {
  const snap = await getDoc(doc(db, COL, id)).catch(() => null);
  const p = snap?.exists() ? snap.data() : null;
  const nomeProd = p?.nome || "—";

  window.abrirModal(`Histórico de Custo — ${nomeProd}`,
    `<p class="loading-cell" style="padding:20px">Carregando histórico...</p>`,
    `<button class="btn-ghost" id="btnFechHistCusto">Fechar</button>`);
  document.getElementById("btnFechHistCusto").onclick = () => window.fecharModal();

  try {
    const histSnap = await getDocs(
      query(collection(db, COL_CUSTO_HIST),
        where("produtoId", "==", id),
        orderBy("criadoEm", "desc"),
        limit(50))
    );

    const { margemReais, margemPct } = calcularMargem(p?.preco, p?.precoCusto);
    const cm = corMargem(margemPct);
    const resumoAtual = `
      <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
        <div style="flex:1;min-width:140px;border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:10px 12px">
          <span style="font-size:var(--text-xs);color:var(--gray-400)">Preço de Venda</span>
          <strong style="display:block;font-size:var(--text-lg)">${formatarMoeda(p?.preco || 0)}</strong>
        </div>
        <div style="flex:1;min-width:140px;border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:10px 12px">
          <span style="font-size:var(--text-xs);color:var(--gray-400)">Preço de Custo</span>
          <strong style="display:block;font-size:var(--text-lg)">${formatarMoeda(p?.precoCusto || 0)}</strong>
        </div>
        <div style="flex:1;min-width:140px;border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:10px 12px;background:${cm.bg}">
          <span style="font-size:var(--text-xs);color:${cm.cor}">Margem Atual</span>
          <strong style="display:block;font-size:var(--text-lg);color:${cm.cor}">${formatarMoeda(margemReais)} (${margemPct.toFixed(1)}%)</strong>
        </div>
      </div>`;

    if (histSnap.empty) {
      window.abrirModal(`Histórico de Custo — ${nomeProd}`,
        `${resumoAtual}<p class="empty-cell">Nenhuma alteração de custo registrada ainda.</p>`,
        `<button class="btn-ghost" id="btnFechHistCusto2">Fechar</button>`);
      document.getElementById("btnFechHistCusto2").onclick = () => window.fecharModal();
      return;
    }

    const linhas = histSnap.docs.map(d => {
      const h = d.data();
      const dt = h.criadoEm?.toDate?.() || new Date();
      const { margemPct: mpEpoca } = calcularMargem(h.precoVenda, h.custoDepois);
      const cmEpoca = corMargem(mpEpoca);
      const delta = (h.custoDepois || 0) - (h.custoAntes || 0);
      const corDelta = delta > 0 ? "var(--color-danger)" : delta < 0 ? "var(--color-success)" : "var(--gray-400)";
      const sinal = delta > 0 ? `+${formatarMoeda(delta)}` : delta < 0 ? `-${formatarMoeda(Math.abs(delta))}` : formatarMoeda(0);
      return `<tr>
        <td style="font-size:var(--text-xs);color:var(--gray-400);white-space:nowrap">
          ${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
        </td>
        <td style="text-align:center;color:var(--gray-500)">${formatarMoeda(h.custoAntes || 0)}</td>
        <td style="text-align:center;font-weight:700">${formatarMoeda(h.custoDepois || 0)}</td>
        <td style="text-align:center;font-weight:600;color:${corDelta}">${sinal}</td>
        <td style="text-align:center"><span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:${cmEpoca.bg};color:${cmEpoca.cor}">${mpEpoca.toFixed(1)}%</span></td>
        <td style="font-size:var(--text-xs);color:var(--gray-500)">${escHtml(h.motivo || "—")}</td>
        <td style="font-size:var(--text-xs);color:var(--gray-400)">${escHtml(h.operador || "—")}</td>
      </tr>`;
    }).join("");

    const body = `
      ${resumoAtual}
      <div class="table-wrap" style="max-height:380px;overflow:auto">
        <table class="data-table" style="font-size:var(--text-xs)">
          <thead>
            <tr>
              <th>Data/Hora</th><th style="text-align:center">Custo Antes</th>
              <th style="text-align:center">Custo Depois</th><th style="text-align:center">Variação</th>
              <th style="text-align:center">Margem na época</th><th>Motivo</th><th>Operador</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;

    window.abrirModal(`Histórico de Custo — ${nomeProd}`, body,
      `<button class="btn-ghost" id="btnFechHistCusto3">Fechar</button>`);
    document.getElementById("btnFechHistCusto3").onclick = () => window.fecharModal();
  } catch (err) {
    console.error(err);
    window.abrirModal(`Histórico de Custo — ${nomeProd}`,
      `<p class="empty-cell">Erro ao carregar histórico. Se for a primeira vez, o Firestore pode pedir um índice (veja o console / F12).</p>`,
      `<button class="btn-ghost" id="btnFechHistCusto4">Fechar</button>`);
    document.getElementById("btnFechHistCusto4").onclick = () => window.fecharModal();
  }
}

// ── Código de Barras: gerar (se ausente), exibir e imprimir ───
async function abrirModalCodigoBarras(id) {
  try {
    const ref = doc(db, COL, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) { window.mostrarToast("Produto não encontrado.", "error"); return; }
    let p = snap.data();

    let codigo = (p.codigoBarras || "").trim();
    let foiGerado = false;
    if (!codigo) {
      codigo = gerarCodigoEAN13(p.nome || id);
      try {
        await updateDoc(ref, { codigoBarras: codigo });
        foiGerado = true;
      } catch (err) { console.error("Erro ao salvar código gerado:", err); }
    }

    const body = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-3);padding:var(--space-2)">
        ${foiGerado ? `<p style="font-size:var(--text-xs);color:var(--gray-400)">Nenhum código cadastrado — um código de uso interno foi gerado e salvo automaticamente.</p>` : ""}
        <div id="codBarrasWrap" style="background:#fff;padding:12px;border:1px solid var(--gray-200);border-radius:var(--radius-md);display:flex;flex-direction:column;align-items:center;gap:4px;max-width:100%">
          <strong style="font-size:var(--text-sm);color:var(--gray-800);text-align:center;word-break:break-word">${escHtml(p.nome || "")}</strong>
          <svg id="svgCodBarras"></svg>
          <span style="font-size:var(--text-sm);color:var(--blue-600);font-weight:700">${formatarMoeda(p.preco || 0)}</span>
        </div>
      </div>`;

    window.abrirModal("Código de Barras", body,
      `<button class="btn-ghost" id="btnFechCodBarras">Fechar</button>
       <button class="btn-primary" id="btnImprimirCodBarras">Imprimir Etiqueta</button>`);

    document.getElementById("btnFechCodBarras").onclick = () => window.fecharModal();

    setTimeout(() => {
      try {
        desenharBarras("#svgCodBarras", codigo);
      } catch (err) {
        console.error("Erro ao gerar código de barras visual:", err);
        document.getElementById("svgCodBarras").outerHTML = `<span style="font-family:monospace">${escHtml(codigo)}</span>`;
      }
    }, 30);

    document.getElementById("btnImprimirCodBarras").onclick = () => {
      imprimirCodigoBarras(p.nome || "", p.preco || 0, codigo);
    };
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao carregar código de barras.", "error");
  }
}

// EAN-13 quando o código é válido; qualquer outro código cai para CODE128 (não quebra a etiqueta)
function desenharBarras(seletor, codigo) {
  const opcoes = { height: 60, fontSize: 14, margin: 6 };
  try {
    window.JsBarcode(seletor, codigo, { ...opcoes, format: "EAN13" });
  } catch (_) {
    window.JsBarcode(seletor, codigo, { ...opcoes, format: "CODE128" });
  }
}

function imprimirCodigoBarras(nome, preco, codigo) {
  const win = window.open("", "_blank", "width=420,height=360");
  if (!win) { window.mostrarToast("Permita pop-ups para imprimir a etiqueta.", "error"); return; }
  const codigoJs = JSON.stringify(String(codigo));
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiqueta — ${escHtml(nome)}</title>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
    <style>
      body { font-family: Arial, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; margin:0; }
      .nome { font-size: 15px; font-weight: 700; text-align:center; max-width: 320px; line-height: 1.2; margin-bottom: 4px;
              display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
      .preco { font-size: 16px; font-weight: 700; color:#92704D; margin-top: 2px; }
      @media print { body { padding: 0; } }
    </style></head>
    <body>
      <div class="nome">${escHtml(nome)}</div>
      <svg id="bc"></svg>
      <span class="preco">${formatarMoeda(preco)}</span>
      <script>
        window.onload = function() {
          var cod = ${codigoJs};
          var op = { height: 60, fontSize: 14, margin: 6 };
          try { JsBarcode("#bc", cod, Object.assign({ format: "EAN13" }, op)); }
          catch (e) { try { JsBarcode("#bc", cod, Object.assign({ format: "CODE128" }, op)); } catch (e2) {} }
          setTimeout(function(){ window.print(); }, 200);
        };
      <\/script>
    </body></html>`);
  win.document.close();
}


const LABELS_HIST = {
  entrada:    { txt: "Entrada",    cor: "#065F46", bg: "#D1FAE5" },
  saida:      { txt: "Saída",      cor: "#991B1B", bg: "#FEE2E2" },
  inventario: { txt: "Inventário", cor: "#92704D", bg: "#F7EEDF" },
  venda:      { txt: "Venda",      cor: "#92400E", bg: "#FEF3C7" },
  importacao: { txt: "Importação", cor: "#5B21B6", bg: "#EDE9FE" },
};

let _histGeralDocs = [];

async function abrirHistoricoGeralEstoque() {
  window.abrirModal("Histórico do Estoque (Log Geral)",
    `<p class="loading-cell" style="padding:20px">Carregando movimentações...</p>`,
    `<button class="btn-ghost" id="btnFechHistGeral0">Fechar</button>`);
  document.getElementById("btnFechHistGeral0").onclick = () => window.fecharModal();

  try {
    const snap = await getDocs(
      query(collection(db, COL_HIST), orderBy("criadoEm", "desc"), limit(300))
    );
    _histGeralDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistoricoGeralModal();
  } catch (err) {
    console.error(err);
    window.abrirModal("Histórico do Estoque (Log Geral)",
      `<p class="empty-cell">Erro ao carregar histórico.</p>`,
      `<button class="btn-ghost" id="btnFechHistGeralErr">Fechar</button>`);
    document.getElementById("btnFechHistGeralErr").onclick = () => window.fecharModal();
  }
}

function renderHistoricoGeralModal(filtroTipo = "todos", filtroBusca = "") {
  const busca = filtroBusca.trim().toUpperCase();
  const docs = _histGeralDocs.filter(m => {
    if (filtroTipo !== "todos" && m.tipo !== filtroTipo) return false;
    if (busca && !(m.nomeProduto || "").toUpperCase().includes(busca) && !(m.operador || "").toUpperCase().includes(busca)) return false;
    return true;
  });

  const linhasHtml = !docs.length
    ? `<tr><td colspan="7" class="empty-cell">Nenhuma movimentação encontrada.</td></tr>`
    : docs.map(m => {
        const dt = m.criadoEm?.toDate?.() || new Date();
        const l = LABELS_HIST[m.tipo] || { txt: m.tipo, cor: "#374151", bg: "#F3F4F6" };
        const delta = m.delta ?? ((m.qtdDepois ?? 0) - (m.qtdAntes ?? 0));
        const sinal = delta > 0 ? `+${delta}` : `${delta}`;
        const corDelta = delta > 0 ? "var(--color-success)" : delta < 0 ? "var(--color-danger)" : "var(--gray-400)";
        return `<tr>
          <td style="font-size:var(--text-xs);color:var(--gray-400);white-space:nowrap">
            ${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}
          </td>
          <td style="font-weight:600;color:var(--gray-800)">${escHtml(m.nomeProduto || "—")}</td>
          <td><span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:${l.bg};color:${l.cor}">${l.txt}</span></td>
          <td style="text-align:center;font-weight:600;color:${corDelta}">${sinal}</td>
          <td style="text-align:center;color:var(--gray-500)">${m.qtdAntes ?? "—"} → ${m.qtdDepois ?? "—"}</td>
          <td style="font-size:var(--text-xs);color:var(--gray-500)">${escHtml(m.motivo || "—")}</td>
          <td style="font-size:var(--text-xs);color:var(--gray-400)">${escHtml(m.operador || "—")}</td>
        </tr>`;
      }).join("");

  const body = `
    <div style="display:flex;flex-direction:column;gap:var(--space-3)">
      <div class="filter-bar" style="margin:0">
        <input type="text" id="mHistGeralBusca" class="field-input--plain" placeholder="Buscar por produto ou operador..." style="flex:1" value="${escHtml(filtroBusca)}" />
        <select id="mHistGeralTipo" class="field-input--plain" style="min-width:160px">
          <option value="todos" ${filtroTipo==="todos"?"selected":""}>Todos os tipos</option>
          <option value="entrada" ${filtroTipo==="entrada"?"selected":""}>Entrada</option>
          <option value="saida" ${filtroTipo==="saida"?"selected":""}>Saída</option>
          <option value="inventario" ${filtroTipo==="inventario"?"selected":""}>Inventário</option>
          <option value="venda" ${filtroTipo==="venda"?"selected":""}>Venda</option>
          <option value="importacao" ${filtroTipo==="importacao"?"selected":""}>Importação</option>
        </select>
      </div>
      <p style="font-size:var(--text-xs);color:var(--gray-400);margin:0">Mostrando ${docs.length} de ${_histGeralDocs.length} movimentações (últimas 300 registradas).</p>
      <div class="table-wrap" style="max-height:440px;overflow:auto">
        <table class="data-table" style="font-size:var(--text-xs)">
          <thead>
            <tr>
              <th>Data/Hora</th><th>Produto</th><th>Tipo</th>
              <th style="text-align:center">Δ Qtd</th><th style="text-align:center">Antes → Depois</th>
              <th>Motivo</th><th>Operador</th>
            </tr>
          </thead>
          <tbody>${linhasHtml}</tbody>
        </table>
      </div>
    </div>`;

  window.abrirModal("Histórico do Estoque (Log Geral)", body,
    `<button class="btn-ghost" id="btnExportHistGeral">
       <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
       Exportar Excel
     </button>
     <button class="btn-ghost" id="btnFechHistGeral">Fechar</button>`);

  document.getElementById("btnFechHistGeral").onclick = () => window.fecharModal();

  document.getElementById("mHistGeralBusca").addEventListener("input", (e) => {
    renderHistoricoGeralModal(document.getElementById("mHistGeralTipo").value, e.target.value);
    // Mantém foco e cursor no campo de busca após o re-render
    setTimeout(() => {
      const inp = document.getElementById("mHistGeralBusca");
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 0);
  });
  document.getElementById("mHistGeralTipo").addEventListener("change", (e) => {
    renderHistoricoGeralModal(e.target.value, document.getElementById("mHistGeralBusca").value);
  });

  document.getElementById("btnExportHistGeral").onclick = () => {
    const cabecalho = [["Data/Hora","Produto","Tipo","Delta","Antes","Depois","Motivo","Operador"]];
    const rows = docs.map(m => {
      const dt = m.criadoEm?.toDate?.() || new Date();
      const delta = m.delta ?? ((m.qtdDepois ?? 0) - (m.qtdAntes ?? 0));
      return [
        `${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`,
        m.nomeProduto || "", LABELS_HIST[m.tipo]?.txt || m.tipo,
        delta >= 0 ? `+${delta}` : `${delta}`,
        m.qtdAntes ?? "", m.qtdDepois ?? "", m.motivo || "", m.operador || ""
      ];
    });
    exportarExcel(`historico_estoque_geral_${new Date().toISOString().split("T")[0]}.xlsx`,
      [...cabecalho, ...rows]);
  };
}

function confirmarExcluirProduto(id) {
  const body = `<div class="delete-warning"><strong>⚠️ Atenção!</strong> Este produto será excluído permanentemente.</div>`;
  const footer = `
    <button class="btn-ghost" id="btnCancelarModalProd">Cancelar</button>
    <button class="btn-danger" id="btnConfirmarExcluirProd">Excluir Produto</button>`;
  window.abrirModal("Excluir Produto", body, footer);
  document.getElementById("btnCancelarModalProd").onclick = () => window.fecharModal();
  document.getElementById("btnConfirmarExcluirProd").onclick = () => excluirProduto(id);
}

async function excluirProduto(id) {
  const btn = document.getElementById("btnConfirmarExcluirProd");
  btn.disabled = true; btn.textContent = "Excluindo...";
  try {
    await deleteDoc(doc(db, COL, id));
    window.fecharModal();
    window.mostrarToast("Produto excluído.", "success");
    carregarListaProdutos();
    atualizarIndicadoresProdutos();
  } catch (err) {
    window.mostrarToast("Erro ao excluir.", "error");
    btn.disabled = false; btn.textContent = "Excluir Produto";
  }
}

async function exportarProdutos() {
  try {
    const snap = await getDocs(query(collection(db, COL), orderBy("nome")));
    const linhas = [["Nome","Código","Código de Barras","Categoria","Preço Venda","Preço Custo","Estoque","Unidade","Estoque Mínimo","Outros Gastos","Impostos (%)","Taxas de Pagamento (%)"]];
    snap.forEach(d => {
      const p = d.data();
      linhas.push([p.nome||"", p.codigo||"", p.codigoBarras||"", p.categoria||"", p.preco||0, p.precoCusto||0, p.estoque||0, p.unidade||"un", p.estoqueMinimo||0, p.outrosGastos||0, p.impostosPct||0, p.taxasPct||0]);
    });
    const ok = exportarExcel(`produtos_${new Date().toISOString().split("T")[0]}.xlsx`, linhas);
    if (ok) window.mostrarToast("Produtos exportados!", "success");
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao exportar.", "error");
  }
}

// ── Importação de produtos (CSV / Excel / JSON) ─────────────────
async function lerArquivoTabular(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "json") {
    const conteudo = JSON.parse(await file.text());
    // Aceita tanto uma lista direta quanto os backups do painel
    // ({ produtos: [...] } ou { colecoes: { produtos: [...] } }).
    const produtos = Array.isArray(conteudo)
      ? conteudo
      : conteudo?.produtos || conteudo?.colecoes?.produtos;
    if (!Array.isArray(produtos)) {
      throw new Error("O JSON precisa conter uma lista de produtos, a chave 'produtos' ou 'colecoes.produtos'.");
    }
    const campo = (produto, ...nomes) => {
      const chaves = Object.keys(produto || {});
      const normalizar = (valor) => String(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const chave = chaves.find((item) => nomes.some((nome) => normalizar(item) === normalizar(nome)));
      return chave ? produto[chave] ?? "" : "";
    };
    const cabecalho = ["NOME", "CODIGO", "CODIGO DE BARRAS", "CATEGORIA", "PRECO VENDA", "PRECO CUSTO", "ESTOQUE", "UNIDADE", "ESTOQUE MINIMO", "OUTROS GASTOS", "IMPOSTOS", "TAXAS", "FOTO"];
    const linhas = produtos.filter((produto) => produto && typeof produto === "object").map((produto) => {
      const foto = campo(produto, "imagem") || (Array.isArray(produto.imagens) ? produto.imagens[0] : "");
      return [
        campo(produto, "nome"),
        campo(produto, "codigo", "codigoInterno"),
        campo(produto, "codigoBarras", "ean", "barcode"),
        campo(produto, "categoria"),
        campo(produto, "preco", "precoVenda"),
        campo(produto, "precoCusto", "custo"),
        campo(produto, "estoque", "quantidade"),
        campo(produto, "unidade"),
        campo(produto, "estoqueMinimo", "minimo"),
        campo(produto, "outrosGastos"),
        campo(produto, "impostosPct", "impostos"),
        campo(produto, "taxasPct", "taxas"),
        foto
      ];
    });
    return [cabecalho, ...linhas];
  }
  if (ext === "xlsx" || ext === "xls") {
    if (!window.XLSX) { window.mostrarToast("Biblioteca XLSX ainda carregando.", "error"); return null; }
    const buf = await file.arrayBuffer();
    const wb  = window.XLSX.read(buf, { type: "array", cellDates: true });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }).map(r => r.map(c => {
      if (c instanceof Date) return `${String(c.getDate()).padStart(2,"0")}/${String(c.getMonth()+1).padStart(2,"0")}/${c.getFullYear()}`;
      return String(c ?? "").trim();
    }));
  }
  const texto = await file.text();
  const sep = texto.split("\n")[0].includes(";") ? ";" : ",";
  return texto.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(v => v.trim().replace(/^"|"$/g, "")));
}

async function importarProdutos(file) {
  let linhasRaw;
  try { linhasRaw = await lerArquivoTabular(file); }
  catch (err) { console.error(err); window.mostrarToast(err.message || "Erro ao ler arquivo.", "error"); return; }
  if (!linhasRaw || linhasRaw.length < 2) { window.mostrarToast("Arquivo vazio ou inválido.", "error"); return; }

  const cab = linhasRaw[0].map(c => String(c).toUpperCase().replace(/\s+/g, " ").trim());
  const col = (...ns) => { for (const n of ns) { const i = cab.findIndex(c => c.includes(n)); if (i !== -1) return i; } return -1; };
  const iNome = col("NOME"), iCodigo = col("CÓDIGO", "CODIGO INTERNO", "CODIGO"), iCodBarras = col("CÓDIGO DE BARRAS","CODIGO DE BARRAS","BARRAS"),
        iCategoria = col("CATEGORIA"), iPreco = col("PREÇO VENDA","PRECO VENDA","PREÇO","PRECO"), iPrecoCusto = col("PREÇO CUSTO","PRECO CUSTO","CUSTO"),
        iEstoque = col("ESTOQUE"), iUnidade = col("UNIDADE"), iEstMin = col("ESTOQUE MÍNIMO","ESTOQUE MINIMO","MÍNIMO","MINIMO"), iOutros = col("OUTROS GASTOS","OUTROS"), iImpostos = col("IMPOSTOS"), iTaxas = col("TAXAS"), iFoto = col("FOTO", "IMAGEM");

  if (iNome === -1) { window.mostrarToast("Coluna NOME não encontrada na planilha.", "error"); return; }
  const dados = linhasRaw.slice(1).filter(r => String(r[iNome] || "").trim());
  if (!dados.length) { window.mostrarToast("Nenhum produto encontrado no arquivo.", "error"); return; }

  const body = `<div style="margin-bottom:var(--space-4)">
    <p style="font-size:var(--text-sm);color:var(--gray-600);margin-bottom:var(--space-3)">
      Encontrados <strong>${dados.length} produto(s)</strong>. Produtos com nome já cadastrado serão ignorados.</p>
    <div style="max-height:260px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse;font-size:var(--text-xs)">
        <thead style="position:sticky;top:0;background:#F8FAFC">
          <tr><th style="padding:8px 12px;text-align:left">Nome</th><th style="padding:8px 12px;text-align:right">Preço</th><th style="padding:8px 12px;text-align:right">Estoque</th></tr>
        </thead><tbody>
          ${dados.map(r => `<tr style="border-bottom:1px solid var(--gray-100)">
            <td style="padding:7px 12px">${escHtml(String(r[iNome]||"").trim())}</td>
            <td style="padding:7px 12px;text-align:right">${formatarMoeda(parseFloat((r[iPreco]||"0").toString().replace(",", ".")) || 0)}</td>
            <td style="padding:7px 12px;text-align:right">${iEstoque!==-1 ? (r[iEstoque]||0) : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div></div>`;

  window.abrirModal("Importar Produtos — Prévia", body,
    `<button class="btn-ghost" id="btnCancImportProd">Cancelar</button>
     <button class="btn-primary" id="btnConfImportProd">Importar ${dados.length} produto(s)</button>`);
  document.getElementById("btnCancImportProd").onclick = () => window.fecharModal();
  document.getElementById("btnConfImportProd").onclick = async () => {
    const btn = document.getElementById("btnConfImportProd");
    btn.disabled = true; btn.textContent = "Importando...";
    const existSnap = await getDocs(collection(db, COL));
    const existentes = new Set(); existSnap.forEach(d => existentes.add((d.data().nome||"").toUpperCase().trim()));
    let imp = 0, ign = 0, erros = 0;
    for (const r of dados) {
      const nome = String(r[iNome] || "").trim();
      if (!nome || existentes.has(nome.toUpperCase())) { ign++; continue; }
      try {
        const estoqueImport = iEstoque!==-1 ? (parseInt(r[iEstoque]) || 0) : 0;
        const ref = await addDoc(collection(db, COL), {
          nome,
          codigo: iCodigo!==-1 ? String(r[iCodigo]||"").trim() : "",
          codigoBarras: iCodBarras!==-1 ? String(r[iCodBarras]||"").trim() : "",
          categoria: iCategoria!==-1 ? String(r[iCategoria]||"").trim() : "",
          preco: iPreco!==-1 ? (parseFloat(String(r[iPreco]||"0").replace(",", ".")) || 0) : 0,
          precoCusto: iPrecoCusto!==-1 ? (parseFloat(String(r[iPrecoCusto]||"0").replace(",", ".")) || 0) : 0,
          estoque: estoqueImport,
          unidade: iUnidade!==-1 ? (String(r[iUnidade]||"un").trim() || "un") : "un",
          estoqueMinimo: iEstMin!==-1 ? (parseInt(r[iEstMin]) || 0) : 0,
          outrosGastos: iOutros!==-1 ? (parseFloat(String(r[iOutros]||"0").replace(",", ".")) || 0) : 0,
          impostosPct: iImpostos!==-1 ? (parseFloat(String(r[iImpostos]||"0").replace(",", ".")) || 0) : 0,
          taxasPct: iTaxas!==-1 ? (parseFloat(String(r[iTaxas]||"0").replace(",", ".")) || 0) : 0,
          foto: iFoto!==-1 ? String(r[iFoto] || "").trim() || null : null,
          criadoEm: serverTimestamp()
        });
        if (estoqueImport > 0) {
          await gravarMovimentacao({
            produtoId: ref.id, nomeProduto: nome,
            tipo: "importacao", qtdAntes: 0, qtdDepois: estoqueImport,
            motivo: "Importação de planilha", operador: _dadosUsuario?.nome || "—"
          });
        }
        existentes.add(nome.toUpperCase()); imp++;
      } catch (e) { console.error(e); erros++; }
      const total = dados.length, feito = imp + ign + erros;
      const b = document.getElementById("btnConfImportProd"); if (b) b.textContent = `Importando... (${feito}/${total})`;
    }
    window.fecharModal();
    window.mostrarToast(`Importação: ${imp} importado(s), ${ign} ignorado(s)${erros?`, ${erros} erro(s)`:""}`, imp>0?"success":"error");
    carregarProdutosPage();
  };
}
