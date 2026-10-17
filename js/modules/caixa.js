// caixa.js — Módulo Caixa — Gerência Viviane Vargas Stories (Terminal PDV)
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "../services/firebase-config.js";
import { formatarMoeda, escHtml } from "../utils/database.js";

const COL_VENDAS   = "vv_vendas";
const COL_PRODUTOS = "vv_produtos";
const COL_ITENS    = "vv_venda_itens";
const COL_CLI_PROM = "prom_clientes";
const COL_COMP_PROM = "prom_compras";
const COL_SESSOES  = "vv_caixa_sessoes";
const COL_HIST     = "vv_estoque_historico";

let _dadosUsuario = null;
let _usuarioId = "";
let _sessaoCaixa = null; // { id, status, valorInicial, operadorAbertura, abertura, sangrias: [] }

// ── Estado do Terminal PDV ───────────────────────────────────
let _produtos = [];
let _clientesProm = [];
let _itensVenda = [];
let _qtdPendente = 1;
let _descontoTotal = { tipo: "rs", valor: 0 };
let _acrescimo = { tipo: "rs", valor: 0 };
let _clienteFiado = null; // { id, nome }
let _pdvIniciado = false;
let _splitPagamentos = []; // [{ forma, valor }] usado quando formaPagamento === "Múltiplo"
let _splitSeq = 0;
let _isFinalizing = false;
let _vendaEmFinalizacaoId = null;
const FORMAS_SPLIT = ["Dinheiro", "PIX", "Cartão de Débito", "Cartão de Crédito"];

export function iniciarCaixa(usuario, dadosUsuario) {
  _dadosUsuario = dadosUsuario;
  _usuarioId = usuario?.uid || "";

  // Garante que o PDV não aparece enquanto o estado não é carregado
  const pdvGrid = document.getElementById("pdvGridWrap");
  if (pdvGrid) pdvGrid.hidden = true;

  document.addEventListener("navegacao", (e) => {
    if (e.detail.page === "caixa") entrarPaginaCaixa();
    else sairModoFoco();
  });
  document.addEventListener("fullscreenchange", sincronizarModoFoco);
  window.addEventListener("resize", sincronizarModoFoco);
}

// ══════════════════════════════════════════════════════════════
// SESSÃO DE CAIXA — abertura / fechamento / sangria
// ══════════════════════════════════════════════════════════════

async function entrarPaginaCaixa() {
  renderHeaderCaixa(null); // limpa enquanto carrega
  try {
    const snap = await getDocs(
      query(collection(db, COL_SESSOES),
        where("status", "==", "aberto"),
        orderBy("abertura", "desc"),
        limit(1))
    );
    _sessaoCaixa = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (err) {
    console.error(err);
    _sessaoCaixa = null;
    if (err.code === "failed-precondition" || (err.message || "").includes("requires an index")) {
      window.mostrarToast("Firestore precisa de um índice para o Caixa. Veja o link no console (F12) e crie o índice — leva ~1 min.", "error", 8000);
    }
  }
  renderHeaderCaixa(_sessaoCaixa);
  mostrarEstadoCaixa(_sessaoCaixa);
  if (_sessaoCaixa) iniciarTerminalPDV();
}

function renderHeaderCaixa(sessao) {
  const subtitleEl = document.getElementById("caixaSubtitle");
  const actionsEl  = document.getElementById("caixaHeaderActions");
  if (!subtitleEl || !actionsEl) return;

  if (!sessao) {
    subtitleEl.innerHTML = `<span class="caixa-status-badge caixa-status-badge--fechado"><span class="caixa-status-dot"></span> Fechado</span>`;
    actionsEl.innerHTML = `
      <button class="btn-primary" id="btnAbrirCaixaHeader">
        <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
        Abrir Caixa
      </button>`;
    document.getElementById("btnAbrirCaixaHeader")?.addEventListener("click", abrirModalAberturaCaixa);
    document.getElementById("btnAbrirCaixaMain")?.addEventListener("click", abrirModalAberturaCaixa);
    return;
  }

  const ab = sessao.abertura?.toDate?.() || new Date(sessao.abertura);
  subtitleEl.innerHTML = `
    <span class="caixa-status-badge caixa-status-badge--aberto"><span class="caixa-status-dot"></span> Aberto</span>
    <span style="font-size:var(--text-xs);color:var(--gray-400);margin-left:8px">por <strong>${escHtml(sessao.operadorAbertura || "—")}</strong> às ${ab.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>`;
  actionsEl.innerHTML = `
    <button class="btn-ghost" id="btnTelaCheiaCaixa" title="Alternar tela cheia">Tela cheia</button>
    <button class="btn-ghost" id="btnSangriaCaixa">
      <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/></svg>
      Sangria
    </button>
    <button class="btn-ghost" id="btnHistoricoCaixa">
      <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path fill-rule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3z" clip-rule="evenodd"/></svg>
      Histórico
    </button>
    <button class="btn-danger" id="btnFecharCaixa">
      <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>
      Fechar Caixa
    </button>`;
  document.getElementById("btnTelaCheiaCaixa")?.addEventListener("click", alternarTelaCheia);
  document.getElementById("btnSangriaCaixa")?.addEventListener("click", abrirModalSangria);
  document.getElementById("btnHistoricoCaixa")?.addEventListener("click", abrirHistoricoCaixa);
  document.getElementById("btnFecharCaixa")?.addEventListener("click", abrirModalFechamentoCaixa);
}

async function alternarTelaCheia() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    window.mostrarToast("O navegador bloqueou a tela cheia.", "warning");
  }
}

function sincronizarModoFoco() {
  const pareceF11 = window.innerHeight >= screen.height - 8;
  const ativo = Boolean(document.fullscreenElement) || pareceF11;
  document.body.classList.toggle("modo-foco", ativo && !document.getElementById("page-caixa")?.hidden);
  const btn = document.getElementById("btnTelaCheiaCaixa");
  if (btn) btn.textContent = ativo ? "Sair da tela cheia" : "Tela cheia";
}

function sairModoFoco() {
  document.body.classList.remove("modo-foco");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function mostrarEstadoCaixa(sessao) {
  const fechadoCard = document.getElementById("caixaFechadoCard");
  const pdvGrid     = document.getElementById("pdvGridWrap");
  if (!fechadoCard || !pdvGrid) return;
  if (sessao) {
    fechadoCard.hidden = true;
    pdvGrid.hidden     = false;
  } else {
    fechadoCard.hidden = false;
    pdvGrid.hidden     = true;
  }
}

// ── Modal: Abrir Caixa ───────────────────────────────────────
function abrirModalAberturaCaixa() {
  window.abrirModal("Abrir Caixa",
    `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <p style="color:var(--gray-600);font-size:var(--text-sm)">Informe o valor inicial disponível em dinheiro (fundo de troco) para iniciar o caixa.</p>
      <div>
        <label class="field-label">Valor inicial (fundo de troco) *</label>
        <input type="number" id="mAbrirValorInicial" class="field-input--plain" min="0" step="0.01" placeholder="0,00" />
      </div>
      <div>
        <label class="field-label">Observação (opcional)</label>
        <input type="text" id="mAbrirObsAbertura" class="field-input--plain" placeholder="Ex: caixa com troco para manhã" />
      </div>
    </div>`,
    `<button class="btn-ghost" id="btnCancAbrirCaixa">Cancelar</button>
     <button class="btn-primary" id="btnConfAbrirCaixa">
       <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
       Confirmar Abertura
     </button>`
  );
  document.getElementById("btnCancAbrirCaixa").onclick = () => window.fecharModal();
  document.getElementById("btnConfAbrirCaixa").onclick = confirmarAberturaCaixa;
  document.getElementById("mAbrirValorInicial").focus();
}

async function confirmarAberturaCaixa() {
  const valorInicial = parseFloat(document.getElementById("mAbrirValorInicial").value) || 0;
  const obs = document.getElementById("mAbrirObsAbertura").value.trim();
  const btn = document.getElementById("btnConfAbrirCaixa");
  btn.disabled = true; btn.textContent = "Abrindo...";
  try {
    const ref = await addDoc(collection(db, COL_SESSOES), {
      status: "aberto",
      valorInicial,
      observacaoAbertura: obs,
      operadorAbertura: _dadosUsuario?.nome || "—",
      operadorAberturaId: _usuarioId,
      abertura: serverTimestamp(),
      sangrias: [],
      fechamento: null,
      operadorFechamento: "",
      valorFinalDeclarado: null,
      observacaoFechamento: ""
    });
    _sessaoCaixa = {
      id: ref.id, status: "aberto", valorInicial,
      operadorAbertura: _dadosUsuario?.nome || "—",
      abertura: Timestamp.fromDate(new Date()),
      sangrias: []
    };
    window.fecharModal();
    renderHeaderCaixa(_sessaoCaixa);
    mostrarEstadoCaixa(_sessaoCaixa);
    iniciarTerminalPDV();
    window.mostrarToast(`Caixa aberto com ${formatarMoeda(valorInicial)} de fundo de troco.`, "success");
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao abrir caixa.", "error");
    btn.disabled = false; btn.textContent = "Confirmar Abertura";
  }
}

// ── Modal: Sangria ───────────────────────────────────────────
function abrirModalSangria() {
  const sangriasHtml = (_sessaoCaixa?.sangrias || []).length
    ? `<div class="caixa-sangrias-lista">
        ${_sessaoCaixa.sangrias.map(s => {
          const dt = s.hora?.toDate?.() || new Date(s.hora);
          return `<div class="item">
            <span>${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · ${escHtml(s.motivo||"—")}</span>
            <strong style="color:var(--color-danger)">- ${formatarMoeda(s.valor)}</strong>
          </div>`;
        }).join("")}
      </div>`
    : `<p style="font-size:var(--text-xs);color:var(--gray-400)">Nenhuma sangria registrada ainda.</p>`;

  window.abrirModal("Registrar Sangria",
    `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <p style="color:var(--gray-600);font-size:var(--text-sm)">Sangria é a retirada de dinheiro do caixa durante o expediente (ex: depósito bancário, retirada do proprietário).</p>
      <div class="pdv-grid-2">
        <div>
          <label class="field-label">Valor retirado *</label>
          <input type="number" id="mSangriaValor" class="field-input--plain" min="0.01" step="0.01" placeholder="0,00" />
        </div>
        <div>
          <label class="field-label">Motivo</label>
          <input type="text" id="mSangriaMotivo" class="field-input--plain" placeholder="Ex: depósito bancário" />
        </div>
      </div>
      <div>
        <label class="field-label" style="margin-bottom:4px">Sangrias de hoje</label>
        ${sangriasHtml}
      </div>
    </div>`,
    `<button class="btn-ghost" id="btnCancSangria">Cancelar</button>
     <button class="btn-danger" id="btnConfSangria">Registrar Sangria</button>`
  );
  document.getElementById("btnCancSangria").onclick = () => window.fecharModal();
  document.getElementById("btnConfSangria").onclick = confirmarSangria;
  document.getElementById("mSangriaValor").focus();
}

async function confirmarSangria() {
  const valor = parseFloat(document.getElementById("mSangriaValor").value) || 0;
  const motivo = document.getElementById("mSangriaMotivo").value.trim();
  if (valor <= 0) { window.mostrarToast("Informe um valor válido.", "error"); return; }
  const btn = document.getElementById("btnConfSangria");
  btn.disabled = true; btn.textContent = "Salvando...";
  try {
    const novaSangria = {
      numero: (_sessaoCaixa.sangrias || []).length + 1,
      valor, motivo, operador: _dadosUsuario?.nome || "—", operadorId: _usuarioId, hora: Timestamp.fromDate(new Date())
    };
    await updateDoc(doc(db, COL_SESSOES, _sessaoCaixa.id), { sangrias: arrayUnion(novaSangria) });
    _sessaoCaixa.sangrias = [...(_sessaoCaixa.sangrias || []), novaSangria];
    window.fecharModal();
    window.mostrarToast(`Sangria de ${formatarMoeda(valor)} registrada.`, "success");
    abrirComprovanteSangria(novaSangria);
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao registrar sangria.", "error");
    btn.disabled = false; btn.textContent = "Registrar Sangria";
  }
}

function abrirComprovanteSangria(sangria) {
  const data = sangria.hora?.toDate?.() || new Date();
  const conteudo = `
    <div class="comprovante-pdv">
      <h2>COMPROVANTE DE SANGRIA</h2>
      <p><strong>Número:</strong> #${sangria.numero}</p>
      <p><strong>Operador:</strong> ${escHtml(sangria.operador)}</p>
      <p><strong>Data/hora:</strong> ${data.toLocaleString("pt-BR")}</p>
      <p><strong>Valor:</strong> ${formatarMoeda(sangria.valor)}</p>
      <p><strong>Motivo:</strong> ${escHtml(sangria.motivo || "Não informado")}</p>
    </div>`;
  window.abrirModal("Comprovante de Sangria", conteudo,
    `<button class="btn-ghost" id="btnFecharCompSangria">Fechar</button>
     <button class="btn-primary" id="btnImprimirCompSangria">Imprimir / Salvar PDF</button>`);
  document.getElementById("btnFecharCompSangria").onclick = () => window.fecharModal();
  document.getElementById("btnImprimirCompSangria").onclick = () => imprimirConteudo("Comprovante de sangria", conteudo);
}

// ── Modal: Fechar Caixa ──────────────────────────────────────
async function abrirModalFechamentoCaixa() {
  // Calcula totais das vendas desta sessão
  let totalVendas = 0, totalDinheiro = 0, totalPix = 0, totalCartao = 0, totalFiado = 0, qtdVendas = 0;
  try {
    const snap = await getDocs(query(collection(db, COL_VENDAS), where("sessaoId", "==", _sessaoCaixa.id)));
    snap.forEach(d => {
      const v = d.data();
      if (v.status === "cancelada") return;
      qtdVendas++;
      totalVendas += v.total || 0;
      if (Array.isArray(v.pagamentos) && v.pagamentos.length) {
        v.pagamentos.forEach(p => {
          const f = p.forma || "";
          if (f === "Dinheiro") totalDinheiro += p.valor || 0;
          else if (f === "PIX") totalPix += p.valor || 0;
          else if (f.startsWith("Cartão")) totalCartao += p.valor || 0;
        });
        return;
      }
      const f = v.formaPagamento || "";
      if (f === "Dinheiro") totalDinheiro += v.total || 0;
      else if (f === "PIX") totalPix += v.total || 0;
      else if (f.startsWith("Cartão")) totalCartao += v.total || 0;
      else if (f === "Fiado") totalFiado += v.total || 0;
    });
  } catch (err) { console.error(err); }

  const totalSangrias = (_sessaoCaixa.sangrias || []).reduce((s, x) => s + (x.valor || 0), 0);
  const saldoEsperado = (_sessaoCaixa.valorInicial || 0) + totalDinheiro - totalSangrias;

  window.abrirModal("Fechar Caixa",
    `<div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <div class="caixa-resumo-fechamento">
        <div class="linha"><span>Fundo inicial</span><strong>${formatarMoeda(_sessaoCaixa.valorInicial || 0)}</strong></div>
        <div class="linha"><span>Vendas (${qtdVendas}x)</span><strong>${formatarMoeda(totalVendas)}</strong></div>
        <div class="linha" style="padding-left:12px;color:var(--gray-400)"><span>↳ Dinheiro</span><span>${formatarMoeda(totalDinheiro)}</span></div>
        <div class="linha" style="padding-left:12px;color:var(--gray-400)"><span>↳ PIX</span><span>${formatarMoeda(totalPix)}</span></div>
        <div class="linha" style="padding-left:12px;color:var(--gray-400)"><span>↳ Cartão</span><span>${formatarMoeda(totalCartao)}</span></div>
        <div class="linha" style="padding-left:12px;color:var(--gray-400)"><span>↳ Fiado</span><span>${formatarMoeda(totalFiado)}</span></div>
        <div class="linha"><span>Sangrias (${(_sessaoCaixa.sangrias||[]).length}x)</span><strong style="color:var(--color-danger)">- ${formatarMoeda(totalSangrias)}</strong></div>
        <div class="linha linha--total"><span>Saldo esperado em dinheiro</span><strong style="color:var(--blue-600)">${formatarMoeda(saldoEsperado)}</strong></div>
      </div>
      <div class="pdv-grid-2">
        <div>
          <label class="field-label">Valor contado no caixa *</label>
          <input type="number" id="mFechValorContado" class="field-input--plain" min="0" step="0.01" placeholder="0,00" />
        </div>
        <div>
          <label class="field-label">Diferença</label>
          <div class="pdv-troco" id="mFechDiferenca" style="border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:9px 12px">—</div>
        </div>
      </div>
      <div class="caixa-fundo-troco-box" id="caixaFundoTrocoBox" hidden>
        <div class="caixa-fundo-troco-linha">
          <span>Fundo de troco para deixar no caixa</span>
          <strong>${formatarMoeda(_sessaoCaixa.valorInicial || 0)}</strong>
        </div>
        <div class="caixa-fundo-troco-linha caixa-fundo-troco-linha--destaque">
          <span>Você pode retirar do caixa</span>
          <strong id="mFechValorRetirar">R$ 0,00</strong>
        </div>
        <p class="caixa-fundo-troco-nota">Esse valor sai do caixa e o restante (${formatarMoeda(_sessaoCaixa.valorInicial || 0)}) fica guardado como fundo de troco para abrir o caixa de amanhã.</p>
      </div>
      <div>
        <label class="field-label">Observação (opcional)</label>
        <input type="text" id="mFechObs" class="field-input--plain" placeholder="Ex: sobrou troco, conferido com gerente..." />
      </div>
    </div>`,
    `<button class="btn-ghost" id="btnCancFecharCaixa">Cancelar</button>
     <button class="btn-danger" id="btnConfFecharCaixa">Confirmar Fechamento</button>`
  );

  const contadoInput = document.getElementById("mFechValorContado");
  const difEl = document.getElementById("mFechDiferenca");
  const fundoTrocoBox = document.getElementById("caixaFundoTrocoBox");
  const valorRetirarEl = document.getElementById("mFechValorRetirar");
  const fundoInicial = _sessaoCaixa.valorInicial || 0;

  contadoInput.addEventListener("input", () => {
    const contado = parseFloat(contadoInput.value) || 0;
    const dif = contado - saldoEsperado;
    difEl.textContent = (dif >= 0 ? "+" : "") + formatarMoeda(dif);
    difEl.style.color = dif > 0.005 ? "var(--color-success)" : dif < -0.005 ? "var(--color-danger)" : "var(--gray-600)";

    if (contadoInput.value === "" || isNaN(contado)) {
      fundoTrocoBox.hidden = true;
      return;
    }
    const valorRetirar = Math.max(0, contado - fundoInicial);
    valorRetirarEl.textContent = formatarMoeda(valorRetirar);
    fundoTrocoBox.hidden = false;
  });

  document.getElementById("btnCancFecharCaixa").onclick = () => window.fecharModal();
  document.getElementById("btnConfFecharCaixa").onclick = async () => {
    const valorFinal = parseFloat(contadoInput.value);
    if (isNaN(valorFinal)) { window.mostrarToast("Informe o valor contado.", "error"); return; }
    const obs = document.getElementById("mFechObs").value.trim();
    const valorRetiradaSugerida = Math.max(0, valorFinal - fundoInicial);
    const btn = document.getElementById("btnConfFecharCaixa");
    btn.disabled = true; btn.textContent = "Fechando...";
    try {
      await updateDoc(doc(db, COL_SESSOES, _sessaoCaixa.id), {
        status: "fechado",
        fechamento: serverTimestamp(),
        operadorFechamento: _dadosUsuario?.nome || "—",
        valorFinalDeclarado: valorFinal,
        totalVendas, totalDinheiro, totalPix, totalCartao, totalFiado,
        totalSangrias, saldoEsperado,
        diferenca: valorFinal - saldoEsperado,
        valorRetiradaSugerida,
        fundoTrocoProximoDia: fundoInicial,
        observacaoFechamento: obs
      });
      _sessaoCaixa = null;
      window.fecharModal();
      renderHeaderCaixa(null);
      mostrarEstadoCaixa(null);
      window.mostrarToast("Caixa fechado com sucesso!", "success");
    } catch (err) {
      console.error(err);
      window.mostrarToast("Erro ao fechar caixa.", "error");
      btn.disabled = false; btn.textContent = "Confirmar Fechamento";
    }
  };
  contadoInput.focus();
}

// ── Histórico de sessões ─────────────────────────────────────
async function abrirHistoricoCaixa() {
  window.abrirModal("Histórico de Caixa", `<p class="loading-cell" style="padding:24px">Carregando...</p>`,
    `<button class="btn-ghost" id="btnFechHistCaixa">Fechar</button>`);
  document.getElementById("btnFechHistCaixa").onclick = () => window.fecharModal();
  try {
    const snap = await getDocs(query(collection(db, COL_SESSOES), orderBy("abertura", "desc"), limit(30)));
    if (snap.empty) {
      window.abrirModal("Histórico de Caixa", `<p class="empty-cell">Nenhuma sessão registrada ainda.</p>`,
        `<button class="btn-ghost" id="btnFechHistCaixa2">Fechar</button>`);
      document.getElementById("btnFechHistCaixa2").onclick = () => window.fecharModal();
      return;
    }
    const linhas = snap.docs.map(d => {
      const s = d.data();
      const ab = s.abertura?.toDate?.() || new Date(s.abertura);
      const fc = s.fechamento?.toDate?.() || null;
      const statusBadge = s.status === "aberto"
        ? `<span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:#D1FAE5;color:#065F46">● Aberto</span>`
        : `<span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:9999px;background:#F1F5F9;color:#475569">Fechado</span>`;
      const dif = s.diferenca != null ? s.diferenca : null;
      const difStr = dif != null ? `<span style="color:${Math.abs(dif)<0.01?"var(--gray-400)":dif>0?"var(--color-success)":"var(--color-danger)"}">${dif>=0?"+":""}${formatarMoeda(dif)}</span>` : "—";
      return `<tr>
        <td style="font-size:var(--text-xs)">${ab.toLocaleDateString("pt-BR")} ${ab.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</td>
        <td style="font-size:var(--text-xs)">${fc ? fc.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—"}</td>
        <td>${statusBadge}</td>
        <td style="font-size:var(--text-xs)">${escHtml(s.operadorAbertura||"—")}</td>
        <td>${formatarMoeda(s.valorInicial||0)}</td>
        <td>${s.totalVendas!=null ? formatarMoeda(s.totalVendas) : "—"}</td>
        <td>${s.totalSangrias!=null ? formatarMoeda(s.totalSangrias) : "—"}</td>
        <td>${s.saldoEsperado!=null ? formatarMoeda(s.saldoEsperado) : "—"}</td>
        <td>${s.valorFinalDeclarado!=null ? formatarMoeda(s.valorFinalDeclarado) : "—"}</td>
        <td>${difStr}</td>
        <td>${s.valorRetiradaSugerida!=null ? `<strong style="color:#15803D">${formatarMoeda(s.valorRetiradaSugerida)}</strong>` : "—"}</td>
      </tr>`;
    }).join("");
    const body = `<div class="table-wrap" style="max-height:420px;overflow:auto">
      <table class="data-table" style="font-size:var(--text-xs)">
        <thead><tr><th>Abertura</th><th>Fechamento</th><th>Status</th><th>Operador</th><th>Fundo</th><th>Vendas</th><th>Sangrias</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th>Retirar</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
    window.abrirModal("Histórico de Caixa", body,
      `<button class="btn-ghost" id="btnFechHistCaixa3">Fechar</button>`);
    document.getElementById("btnFechHistCaixa3").onclick = () => window.fecharModal();
  } catch (err) {
    console.error(err);
    window.abrirModal("Histórico de Caixa", `<p class="empty-cell">Erro ao carregar histórico.</p>`,
      `<button class="btn-ghost" id="btnFechHistCaixa4">Fechar</button>`);
    document.getElementById("btnFechHistCaixa4").onclick = () => window.fecharModal();
  }
}



async function iniciarTerminalPDV() {
  // Recarrega produtos/clientes a cada entrada na página (estoque pode ter mudado)
  try {
    const [snapProd, snapCli] = await Promise.all([
      getDocs(query(collection(db, COL_PRODUTOS), orderBy("nome"))),
      getDocs(query(collection(db, COL_CLI_PROM), orderBy("nome")))
    ]);
    _produtos = []; snapProd.forEach(d => _produtos.push({ id: d.id, ...d.data() }));
    _clientesProm = []; snapCli.forEach(d => _clientesProm.push({ id: d.id, ...d.data() }));
  } catch (err) { console.error(err); }

  if (_pdvIniciado) { renderItensPDV(); return; } // listeners já presos, só recarrega dados
  _pdvIniciado = true;

  const terminalInput = document.getElementById("terminalInput");

  // ── Terminal: letra = atalho instantâneo (abre modal) · Enter no vazio finaliza · Esc limpa ──
  terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape")    { terminalInput.value = ""; return; }

    // Qualquer letra de comando é atalho instantâneo: nunca aparece digitada no terminal.
    // Se houver dígitos já digitados antes (ex: "5" + P, "2" + D), eles são usados como argumento.
    // Só intercepta as letras que são comando de fato — outras letras (ex: x, r, s...) digitam normal.
    const LETRAS_COMANDO = ["p","q","e","d","c","i","t","a","n","o","h","l","f"];
    if (LETRAS_COMANDO.includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      executarAtalho(e.key.toLowerCase());
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      executarComando(terminalInput.value);
    }
  });

  // ── Itens da venda: limpar tudo / qtd +- / remover (mouse) ──
  document.getElementById("btnLimparItensPDV").addEventListener("click", () => confirmarCancelarVendaPDV());

  document.getElementById("tbodyItensPDV").addEventListener("click", (e) => {
    const incBtn = e.target.closest("[data-inc]");
    const decBtn = e.target.closest("[data-dec]");
    const remBtn = e.target.closest("[data-rem]");
    if (incBtn) { alterarQtdItem(parseInt(incBtn.dataset.inc), 1); }
    else if (decBtn) { alterarQtdItem(parseInt(decBtn.dataset.dec), -1); }
    else if (remBtn) { _itensVenda.splice(parseInt(remBtn.dataset.rem), 1); renderItensPDV(); }
    terminalInput.focus();
  });

  // ── Toggle R$ / % (desconto total e acréscimo) ──
  document.querySelectorAll(".pdv-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target; // descontoTotal | acrescimo
      const tipo = btn.dataset.tipo;      // rs | pct
      document.querySelectorAll(`.pdv-toggle-btn[data-target="${target}"]`).forEach(b => b.classList.remove("pdv-toggle-btn--active"));
      btn.classList.add("pdv-toggle-btn--active");
      const estado = target === "descontoTotal" ? _descontoTotal : _acrescimo;
      estado.tipo = tipo;
      renderResumoPDV();
    });
  });
  document.getElementById("inputDescontoTotal").addEventListener("input", (e) => {
    _descontoTotal.valor = parseFloat(e.target.value) || 0; renderResumoPDV();
  });
  document.getElementById("inputAcrescimo").addEventListener("input", (e) => {
    _acrescimo.valor = parseFloat(e.target.value) || 0; renderResumoPDV();
  });

  // ── Pagamento ──
  document.getElementById("pdvFormaPag").addEventListener("change", (e) => {
    const forma = e.target.value;
    document.getElementById("pdvDinheiroBox").style.display = forma === "Dinheiro" ? "grid" : "none";
    document.getElementById("pdvFiadoBox").hidden = forma !== "Fiado";
    document.getElementById("pdvSplitBox").hidden = forma !== "Múltiplo";
    document.getElementById("pdvPixOrigemBox").hidden = forma !== "PIX";
    if (forma !== "PIX") document.getElementById("pdvPixOrigem").value = "";
    if (forma === "Fiado") document.getElementById("pdvClienteInput").focus();
    if (forma === "Múltiplo") {
      if (!_splitPagamentos.length) {
        _splitPagamentos = [{ id: ++_splitSeq, forma: "Dinheiro", valor: 0 }, { id: ++_splitSeq, forma: "PIX", valor: 0 }];
      }
      renderSplitBox();
    }
  });
  document.getElementById("pdvValorRecebido").addEventListener("input", renderResumoPDV);
  document.getElementById("btnSplitAddLinha").addEventListener("click", () => {
    _splitPagamentos.push({ id: ++_splitSeq, forma: "Dinheiro", valor: 0 });
    renderSplitBox();
  });

  // ── Cliente Fiado: busca + aviso "não encontrado" + novo cliente ──
  const clienteInput = document.getElementById("pdvClienteInput");
  clienteInput.addEventListener("input", () => {
    _clienteFiado = null;
    document.getElementById("pdvClienteSelecionado").hidden = true;
    const termo = clienteInput.value.trim();
    const sugWrap = document.getElementById("pdvClienteSugestoes");
    const avisoWrap = document.getElementById("pdvClienteNaoEncontrado");
    if (!termo) { sugWrap.hidden = true; avisoWrap.hidden = true; return; }
    const achados = _clientesProm.filter(c => (c.nome || "").toUpperCase().includes(termo.toUpperCase()));
    if (achados.length) {
      sugWrap.hidden = false; avisoWrap.hidden = true;
      sugWrap.innerHTML = achados.slice(0, 8).map(c => `
        <div class="pdv-sugestao-item" data-cli-id="${c.id}">
          <div class="pdv-sugestao-thumb">👤</div>
          <div class="pdv-sugestao-info"><strong>${escHtml(c.nome)}</strong>${c.telefone ? `<small>${escHtml(c.telefone)}</small>` : ""}</div>
        </div>`).join("");
      sugWrap.querySelectorAll("[data-cli-id]").forEach(el => {
        el.addEventListener("click", () => {
          const c = _clientesProm.find(x => x.id === el.dataset.cliId);
          selecionarClienteFiado(c);
        });
      });
    } else {
      sugWrap.hidden = true;
      avisoWrap.hidden = false;
    }
  });
  document.getElementById("btnNovoClienteFiado").addEventListener("click", abrirModalNovoClienteFiado);

  // ── Finalizar / cancelar ──
  document.getElementById("btnFinalizarVendaPDV").addEventListener("click", finalizarVendaPDV);

  renderItensPDV();
  renderResumoPDV();
  terminalInput.focus();
}

// ── Atalho instantâneo: trata a letra pressionada usando o número (se houver) já digitado ──
// ── Atalho instantâneo: cada letra abre um modal (mais intuitivo que digitar comando) ──
// Se houver um número já digitado no terminal antes da letra, ele é usado como atalho
// pra pré-selecionar o item / preencher o valor direto, pulando a etapa de escolha manual.
function executarAtalho(letra) {
  const terminalInput = document.getElementById("terminalInput");
  const digitosMatch = terminalInput.value.match(/^\d+/);
  const num = digitosMatch ? parseInt(digitosMatch[0]) : null;
  terminalInput.value = "";

  switch (letra) {
    case "p": abrirModalProduto(num); break;
    case "q": abrirModalQuantidade(num); break;
    case "d": abrirModalExcluirItem(num && _itensVenda[num - 1] ? num - 1 : null); break;
    case "e": abrirModalEditarItem(num && _itensVenda[num - 1] ? num - 1 : null); break;
    case "i": abrirModalDescontoItem(num && _itensVenda[num - 1] ? num - 1 : null); break;
    case "c": confirmarCancelarVendaPDV(); break;
    case "t": abrirModalDescontoTotal(num); break;
    case "a": abrirModalAcrescimo(num); break;
    case "n": abrirModalCpfCnpj(num); break;
    case "o": abrirModalObservacao(); break;
    case "h": abrirHistoricoVendasPDV(); break;
    case "l": break; // terminal já é limpo no início de executarAtalho
    case "f": finalizarVendaPDV(); break;
    default: break;
  }
}

// ── Parser de comandos (usado só pelo Enter no terminal vazio = finalizar venda) ──
function executarComando(textoOriginal) {
  if (!textoOriginal.trim() && _itensVenda.length) finalizarVendaPDV();
}

// ── Lista de itens clicável, reaproveitada nos modais de Editar/Excluir/Desconto ──
function listaItensClicavelHtml() {
  if (!_itensVenda.length) return `<p class="empty-cell">Nenhum item na venda.</p>`;
  return `<div class="pdv-modal-lista-itens">${_itensVenda.map((it, i) => `
    <div class="pdv-modal-item-row" data-modal-item="${i}">
      <div class="prod-thumb-mini">${it.foto ? `<img src="${it.foto}" alt="">` : "📦"}</div>
      <div style="flex:1;min-width:0">
        <strong style="display:block;color:var(--gray-800);font-size:var(--text-sm)">#${i + 1} ${escHtml(it.nome)}</strong>
        <small style="color:var(--gray-400)">Qtd. ${it.qtd} · ${formatarMoeda(it.precoUnit)} cada · Total ${formatarMoeda(itemTotal(it))}</small>
      </div>
    </div>`).join("")}</div>`;
}

// ── P: Adicionar Produto ──────────────────────────────────────
function abrirModalProduto(numPrefill) {
  const qtdInicial = numPrefill || _qtdPendente || 1;
  const body = `
    <div class="form-usuario">
      <label class="field-label">Quantidade</label>
      <input type="number" id="mProdQtd" class="field-input--plain" min="1" step="1" value="${qtdInicial}" style="margin-bottom:var(--space-3)" />
      <label class="field-label">Buscar Produto (nome, código ou código de barras)</label>
      <input type="text" id="mProdBusca" class="field-input--plain" placeholder="Digite para buscar..." autocomplete="off" />
      <div id="mProdSugestoes" style="margin-top:8px;max-height:280px;overflow-y:auto"></div>
    </div>`;
  window.abrirModal("Adicionar Produto", body, `<button class="btn-ghost" id="btnCancProd">Cancelar</button>`);

  let sugs = [], ativo = -1;

  const render = () => {
    const wrap = document.getElementById("mProdSugestoes");
    if (!sugs.length) { wrap.innerHTML = `<p class="empty-cell">Nenhum produto encontrado.</p>`; return; }
    wrap.innerHTML = sugs.map((p, i) => `
      <div class="pdv-sugestao-item ${i === ativo ? "pdv-sugestao-item--ativo" : ""}" data-midx="${i}">
        <div class="pdv-sugestao-thumb">${p.foto ? `<img src="${p.foto}" alt="">` : "📦"}</div>
        <div class="pdv-sugestao-info"><strong>${escHtml(p.nome)}</strong><small>Código: ${escHtml(p.codigoBarras || p.codigo || "—")}</small></div>
        <div class="pdv-sugestao-preco"><strong>${formatarMoeda(p.preco || 0)}</strong><small>Estoque: ${p.estoque || 0}</small></div>
      </div>`).join("");
    wrap.querySelectorAll("[data-midx]").forEach(el => el.addEventListener("click", () => escolher(sugs[parseInt(el.dataset.midx)])));
  };

  const buscar = (termo) => {
    const up = (termo || "").trim().toUpperCase();
    sugs = !up
      ? _produtos.filter(p => (p.estoque || 0) > 0).slice(0, 30)
      : _produtos.filter(p => (p.estoque || 0) > 0 && (
          (p.nome || "").toUpperCase().includes(up) ||
          (p.codigo || "").toUpperCase() === up ||
          (p.codigoBarras || "") === termo.trim()
        )).slice(0, 30);
    ativo = sugs.length ? 0 : -1;
    render();
  };

  const escolher = (p) => {
    const qtd = parseInt(document.getElementById("mProdQtd").value) || 1;
    if (qtd > (p.estoque || 0)) { window.mostrarToast(`Estoque insuficiente (${p.estoque || 0} disponível).`, "error"); return; }
    adicionarItemPDV(p, qtd);
    _qtdPendente = 1;
    window.fecharModal();
    document.getElementById("terminalInput").focus();
  };

  const buscaInput = document.getElementById("mProdBusca");
  buscaInput.addEventListener("input", () => buscar(buscaInput.value));
  buscaInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (sugs.length) { ativo = (ativo + 1) % sugs.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (sugs.length) { ativo = (ativo - 1 + sugs.length) % sugs.length; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); if (sugs.length) escolher(sugs[ativo >= 0 ? ativo : 0]); }
  });
  document.getElementById("btnCancProd").onclick = () => { window.fecharModal(); document.getElementById("terminalInput").focus(); };

  buscar("");
  buscaInput.focus();
}

// ── Q: Definir Quantidade ─────────────────────────────────────
function abrirModalQuantidade(numPrefill) {
  const body = `
    <div class="form-usuario">
      <label class="field-label">Quantidade para o próximo produto</label>
      <input type="number" id="mQtdValor" class="field-input--plain" min="1" step="1" value="${numPrefill || _qtdPendente || 1}" />
      <p style="font-size:var(--text-xs);color:var(--gray-400);margin-top:6px">Depois de confirmar, aperte <strong>P</strong> pra buscar o produto.</p>
    </div>`;
  window.abrirModal("Definir Quantidade", body,
    `<button class="btn-ghost" id="btnCancQtd">Cancelar</button>
     <button class="btn-primary" id="btnConfQtd">Confirmar</button>`);
  const inp = document.getElementById("mQtdValor");
  inp.focus(); inp.select();
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("btnConfQtd").click(); } });
  document.getElementById("btnCancQtd").onclick = () => { window.fecharModal(); document.getElementById("terminalInput").focus(); };
  document.getElementById("btnConfQtd").onclick = () => {
    _qtdPendente = parseInt(inp.value) || 1;
    window.fecharModal();
    window.mostrarToast(`Quantidade definida: ${_qtdPendente}. Agora aperte P.`, "success");
    document.getElementById("terminalInput").focus();
  };
}

// ── E: Editar Quantidade (lista de itens → quantidade) ────────
function abrirModalEditarItem(idx) {
  const terminalInput = document.getElementById("terminalInput");
  if (idx == null) {
    if (!_itensVenda.length) { window.mostrarToast("Nenhum item na venda.", "error"); return; }
    const body = `<div class="form-usuario"><label class="field-label">Selecione o item para editar a quantidade</label>${listaItensClicavelHtml()}</div>`;
    window.abrirModal("Editar Quantidade", body, `<button class="btn-ghost" id="btnCancSelEdit">Cancelar</button>`);
    document.getElementById("btnCancSelEdit").onclick = () => { window.fecharModal(); terminalInput.focus(); };
    document.querySelectorAll("[data-modal-item]").forEach(el =>
      el.addEventListener("click", () => abrirModalEditarItem(parseInt(el.dataset.modalItem))));
    return;
  }
  const it = _itensVenda[idx];
  if (!it) return;
  const body = `
    <div class="form-usuario">
      <div class="pdv-modal-item-row" style="cursor:default">
        <div class="prod-thumb-mini">${it.foto ? `<img src="${it.foto}" alt="">` : "📦"}</div>
        <div style="flex:1"><strong style="display:block;color:var(--gray-800)">#${idx + 1} ${escHtml(it.nome)}</strong>
        <small style="color:var(--gray-400)">${formatarMoeda(it.precoUnit)} cada</small></div>
      </div>
      <label class="field-label" style="margin-top:var(--space-3)">Nova Quantidade</label>
      <input type="number" id="mEditQtd" class="field-input--plain" min="0" step="1" value="${it.qtd}" />
      <p style="font-size:var(--text-xs);color:var(--gray-400);margin-top:6px">Definir como 0 remove o item da venda.</p>
    </div>`;
  window.abrirModal("Editar Quantidade", body,
    `<button class="btn-ghost" id="btnCancEdit">Cancelar</button>
     <button class="btn-primary" id="btnSalvarEdit">Salvar</button>`);
  const inp = document.getElementById("mEditQtd");
  inp.focus(); inp.select();
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("btnSalvarEdit").click(); } });
  document.getElementById("btnCancEdit").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnSalvarEdit").onclick = () => {
    const novaQtd = parseInt(inp.value);
    if (isNaN(novaQtd) || novaQtd < 0) { window.mostrarToast("Quantidade inválida.", "error"); return; }
    if (novaQtd === 0) { _itensVenda.splice(idx, 1); }
    else {
      const prod = _produtos.find(p => p.id === it.produtoId);
      if (prod && novaQtd > (prod.estoque || 0)) { window.mostrarToast(`Estoque insuficiente (${prod.estoque} disponível).`, "error"); return; }
      it.qtd = novaQtd;
    }
    renderItensPDV();
    window.fecharModal();
    window.mostrarToast("Quantidade atualizada.", "success");
    terminalInput.focus();
  };
}

// ── D: Excluir Item (lista de itens → confirmação) ─────────────
function abrirModalExcluirItem(idx) {
  const terminalInput = document.getElementById("terminalInput");
  if (idx == null) {
    if (!_itensVenda.length) { window.mostrarToast("Nenhum item na venda.", "error"); return; }
    const body = `<div class="form-usuario"><label class="field-label">Selecione o item para excluir</label>${listaItensClicavelHtml()}</div>`;
    window.abrirModal("Excluir Item", body, `<button class="btn-ghost" id="btnCancSelDel">Cancelar</button>`);
    document.getElementById("btnCancSelDel").onclick = () => { window.fecharModal(); terminalInput.focus(); };
    document.querySelectorAll("[data-modal-item]").forEach(el =>
      el.addEventListener("click", () => abrirModalExcluirItem(parseInt(el.dataset.modalItem))));
    return;
  }
  const it = _itensVenda[idx];
  if (!it) return;
  const body = `
    <div class="form-usuario">
      <div class="pdv-modal-item-row" style="cursor:default">
        <div class="prod-thumb-mini">${it.foto ? `<img src="${it.foto}" alt="">` : "📦"}</div>
        <div style="flex:1"><strong style="display:block;color:var(--gray-800)">#${idx + 1} ${escHtml(it.nome)}</strong>
        <small style="color:var(--gray-400)">Qtd. ${it.qtd} · ${formatarMoeda(itemTotal(it))}</small></div>
      </div>
      <p style="font-size:var(--text-sm);color:#991B1B;margin-top:var(--space-3)">Tem certeza que deseja remover este item da venda?</p>
    </div>`;
  window.abrirModal("Excluir Item", body,
    `<button class="btn-ghost" id="btnCancDel">Cancelar</button>
     <button class="btn-danger" id="btnConfDel" style="background:#DC2626;color:#fff;border:none;padding:10px 18px;border-radius:var(--radius-md);font-weight:600;cursor:pointer">Excluir Item</button>`);
  document.getElementById("btnCancDel").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnConfDel").onclick = () => {
    _itensVenda.splice(idx, 1);
    renderItensPDV();
    window.fecharModal();
    window.mostrarToast("Item removido.", "success");
    terminalInput.focus();
  };
}

// ── I: Desconto no Item (lista de itens → R$/% + valor) ────────
function abrirModalDescontoItem(idx) {
  const terminalInput = document.getElementById("terminalInput");
  if (idx == null) {
    if (!_itensVenda.length) { window.mostrarToast("Nenhum item na venda.", "error"); return; }
    const body = `<div class="form-usuario"><label class="field-label">Selecione o item para aplicar desconto</label>${listaItensClicavelHtml()}</div>`;
    window.abrirModal("Desconto no Item", body, `<button class="btn-ghost" id="btnCancSelDesc">Cancelar</button>`);
    document.getElementById("btnCancSelDesc").onclick = () => { window.fecharModal(); terminalInput.focus(); };
    document.querySelectorAll("[data-modal-item]").forEach(el =>
      el.addEventListener("click", () => abrirModalDescontoItem(parseInt(el.dataset.modalItem))));
    return;
  }
  const it = _itensVenda[idx];
  if (!it) return;
  const tipoAtual = it.descontoTipo || "rs";
  const valorAtual = it.descontoValor || 0;

  const body = `
    <div class="form-usuario">
      <p style="font-size:var(--text-sm);color:var(--gray-500);margin-bottom:var(--space-3)">
        Item <strong style="color:var(--gray-800)">#${idx + 1} — ${escHtml(it.nome)}</strong>
        &nbsp;·&nbsp; Unitário: ${formatarMoeda(it.precoUnit)} &nbsp;·&nbsp; Qtd.: ${it.qtd}
      </p>
      <label class="field-label">Desconto no Item</label>
      <div class="pdv-toggle-input">
        <button type="button" class="pdv-toggle-btn ${tipoAtual === "rs" ? "pdv-toggle-btn--active" : ""}" data-tipo-modal="rs">R$</button>
        <button type="button" class="pdv-toggle-btn ${tipoAtual === "pct" ? "pdv-toggle-btn--active" : ""}" data-tipo-modal="pct">%</button>
        <input type="number" id="mDescontoItemValor" class="field-input--plain" min="0" step="0.01" value="${valorAtual}" />
      </div>
    </div>`;

  window.abrirModal("Desconto no Item", body,
    `<button class="btn-ghost" id="btnCancDescItem">Cancelar</button>
     <button class="btn-primary" id="btnAplicarDescItem">Aplicar Desconto</button>`);

  let tipoModal = tipoAtual;
  document.querySelectorAll("[data-tipo-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      tipoModal = btn.dataset.tipoModal;
      document.querySelectorAll("[data-tipo-modal]").forEach(b => b.classList.toggle("pdv-toggle-btn--active", b === btn));
    });
  });

  const inputValor = document.getElementById("mDescontoItemValor");
  inputValor.focus(); inputValor.select();
  inputValor.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("btnAplicarDescItem").click(); } });

  document.getElementById("btnCancDescItem").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnAplicarDescItem").onclick = () => {
    it.descontoTipo = tipoModal;
    it.descontoValor = parseFloat(inputValor.value) || 0;
    renderItensPDV();
    window.fecharModal();
    window.mostrarToast("Desconto aplicado ao item.", "success");
    terminalInput.focus();
  };
}

// ── T / A: Desconto Total e Acréscimo (mesmo modal genérico, R$/%) ──
function abrirModalValorComTipo({ titulo, estado, numPrefill, onConfirmar }) {
  const terminalInput = document.getElementById("terminalInput");
  const tipoInicial = numPrefill != null ? "rs" : (estado.tipo || "rs");
  const valorInicial = numPrefill != null ? numPrefill : (estado.valor || 0);
  const body = `
    <div class="form-usuario">
      <label class="field-label">${titulo}</label>
      <div class="pdv-toggle-input">
        <button type="button" class="pdv-toggle-btn ${tipoInicial === "rs" ? "pdv-toggle-btn--active" : ""}" data-tipo-modal="rs">R$</button>
        <button type="button" class="pdv-toggle-btn ${tipoInicial === "pct" ? "pdv-toggle-btn--active" : ""}" data-tipo-modal="pct">%</button>
        <input type="number" id="mValorTipo" class="field-input--plain" min="0" step="0.01" value="${valorInicial}" />
      </div>
    </div>`;
  window.abrirModal(titulo, body,
    `<button class="btn-ghost" id="btnCancValorTipo">Cancelar</button>
     <button class="btn-primary" id="btnConfValorTipo">Aplicar</button>`);
  let tipoModal = tipoInicial;
  document.querySelectorAll("[data-tipo-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      tipoModal = btn.dataset.tipoModal;
      document.querySelectorAll("[data-tipo-modal]").forEach(b => b.classList.toggle("pdv-toggle-btn--active", b === btn));
    });
  });
  const inp = document.getElementById("mValorTipo");
  inp.focus(); inp.select();
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("btnConfValorTipo").click(); } });
  document.getElementById("btnCancValorTipo").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnConfValorTipo").onclick = () => {
    const valor = parseFloat(inp.value) || 0;
    onConfirmar(tipoModal, valor);
    window.fecharModal();
    window.mostrarToast(`${titulo} aplicado.`, "success");
    terminalInput.focus();
  };
}

function abrirModalDescontoTotal(numPrefill) {
  abrirModalValorComTipo({
    titulo: "Desconto Total", estado: _descontoTotal, numPrefill,
    onConfirmar: (tipo, valor) => {
      _descontoTotal = { tipo, valor };
      document.querySelectorAll('.pdv-toggle-btn[data-target="descontoTotal"]').forEach(b => b.classList.toggle("pdv-toggle-btn--active", b.dataset.tipo === tipo));
      document.getElementById("inputDescontoTotal").value = valor;
      renderResumoPDV();
    }
  });
}

function abrirModalAcrescimo(numPrefill) {
  abrirModalValorComTipo({
    titulo: "Acréscimo", estado: _acrescimo, numPrefill,
    onConfirmar: (tipo, valor) => {
      _acrescimo = { tipo, valor };
      document.querySelectorAll('.pdv-toggle-btn[data-target="acrescimo"]').forEach(b => b.classList.toggle("pdv-toggle-btn--active", b.dataset.tipo === tipo));
      document.getElementById("inputAcrescimo").value = valor;
      renderResumoPDV();
    }
  });
}

// ── N: CPF/CNPJ ────────────────────────────────────────────────
function abrirModalCpfCnpj(numPrefill) {
  const terminalInput = document.getElementById("terminalInput");
  const atual = document.getElementById("pdvCpfCnpj").value || "";
  const body = `
    <div class="form-usuario">
      <label class="field-label">CPF / CNPJ na Nota</label>
      <input type="text" id="mCpfCnpj" class="field-input--plain" placeholder="Opcional" value="${numPrefill != null ? numPrefill : escHtml(atual)}" />
    </div>`;
  window.abrirModal("CPF/CNPJ", body,
    `<button class="btn-ghost" id="btnCancCpf">Cancelar</button>
     <button class="btn-primary" id="btnConfCpf">Confirmar</button>`);
  const inp = document.getElementById("mCpfCnpj");
  inp.focus(); inp.select();
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("btnConfCpf").click(); } });
  document.getElementById("btnCancCpf").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnConfCpf").onclick = () => {
    document.getElementById("pdvCpfCnpj").value = inp.value.trim();
    window.fecharModal();
    window.mostrarToast("CPF/CNPJ adicionado.", "success");
    terminalInput.focus();
  };
}

// ── O: Observação ───────────────────────────────────────────────
function abrirModalObservacao() {
  const terminalInput = document.getElementById("terminalInput");
  const atual = document.getElementById("pdvObservacao").value || "";
  const body = `
    <div class="form-usuario">
      <label class="field-label">Observação da Venda</label>
      <textarea id="mObsVenda" class="field-input--plain" rows="3" placeholder="Ex: entregar amanhã de manhã...">${escHtml(atual)}</textarea>
    </div>`;
  window.abrirModal("Observação", body,
    `<button class="btn-ghost" id="btnCancObs">Cancelar</button>
     <button class="btn-primary" id="btnConfObs">Salvar</button>`);
  const inp = document.getElementById("mObsVenda");
  inp.focus();
  document.getElementById("btnCancObs").onclick = () => { window.fecharModal(); terminalInput.focus(); };
  document.getElementById("btnConfObs").onclick = () => {
    document.getElementById("pdvObservacao").value = inp.value.trim();
    window.fecharModal();
    window.mostrarToast("Observação salva.", "success");
    terminalInput.focus();
  };
}


// ── Itens da venda ─────────────────────────────────────────────
function adicionarItemPDV(produto, qtd) {
  qtd = qtd || 1;
  const estoque = produto.estoque || 0;
  const existente = _itensVenda.find(i => i.produtoId === produto.id);
  const qtdAtual = existente ? existente.qtd : 0;
  if (qtdAtual + qtd > estoque) {
    window.mostrarToast(`Estoque insuficiente para ${produto.nome} (${estoque} disponível).`, "error");
    return;
  }
  if (existente) { existente.qtd += qtd; }
  else {
    _itensVenda.push({
      produtoId: produto.id, nome: produto.nome, foto: produto.foto || null,
      precoUnit: produto.preco || 0, qtd,
      descontoTipo: "rs", descontoValor: 0
    });
  }
  renderItensPDV();
  window.mostrarToast(`${qtd}x ${produto.nome} adicionado.`, "success");
}

function alterarQtdItem(idx, delta) {
  const it = _itensVenda[idx];
  if (!it) return;
  const prod = _produtos.find(p => p.id === it.produtoId);
  const novaQtd = it.qtd + delta;
  if (novaQtd <= 0) { _itensVenda.splice(idx, 1); renderItensPDV(); return; }
  if (prod && novaQtd > (prod.estoque || 0)) { window.mostrarToast(`Estoque insuficiente (${prod.estoque} disponível).`, "error"); return; }
  it.qtd = novaQtd;
  renderItensPDV();
}

function itemSubtotal(it) { return it.precoUnit * it.qtd; }
function itemDescontoReais(it) {
  if (!it.descontoValor) return 0;
  return it.descontoTipo === "pct"
    ? itemSubtotal(it) * it.descontoValor / 100
    : Math.min(it.descontoValor, itemSubtotal(it));
}
function itemTotal(it) { return Math.max(0, itemSubtotal(it) - itemDescontoReais(it)); }

function renderItensPDV() {
  const tbody = document.getElementById("tbodyItensPDV");
  if (!_itensVenda.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhum item na venda. Use o terminal para adicionar produtos.</td></tr>`;
    renderResumoPDV();
    return;
  }
  tbody.innerHTML = _itensVenda.map((it, idx) => {
    const desc = itemDescontoReais(it);
    return `<tr>
      <td>${idx + 1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="prod-thumb-mini">${it.foto ? `<img src="${it.foto}" alt="">` : "📦"}</div>
          <strong style="color:var(--gray-800)">${escHtml(it.nome)}</strong>
        </div>
      </td>
      <td>
        <div class="pdv-qtd-controls">
          <button type="button" data-dec="${idx}">−</button>
          <span style="min-width:24px;text-align:center;display:inline-block">${it.qtd}</span>
          <button type="button" data-inc="${idx}">+</button>
        </div>
      </td>
      <td>${formatarMoeda(it.precoUnit)}</td>
      <td style="color:${desc > 0 ? '#DC2626' : 'var(--gray-400)'}">${desc > 0 ? formatarMoeda(desc) : "—"}</td>
      <td><strong>${formatarMoeda(itemTotal(it))}</strong></td>
      <td>
        <button type="button" class="btn-table-action btn-table-action--delete" data-rem="${idx}" title="Remover">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");
  renderResumoPDV();
}

// ── Resumo / totais ────────────────────────────────────────────
function calcularTotaisPDV() {
  const subtotal = _itensVenda.reduce((s, it) => s + itemSubtotal(it), 0);
  const descontoItens = _itensVenda.reduce((s, it) => s + itemDescontoReais(it), 0);
  const base = subtotal - descontoItens;
  const descTotalReais = _descontoTotal.tipo === "pct" ? base * _descontoTotal.valor / 100 : _descontoTotal.valor;
  const baseAposDesc = Math.max(0, base - descTotalReais);
  const acrescimoReais = _acrescimo.tipo === "pct" ? baseAposDesc * _acrescimo.valor / 100 : _acrescimo.valor;
  const total = Math.max(0, baseAposDesc + acrescimoReais);
  return { subtotal, descontoItens, descTotalReais, acrescimoReais, total };
}

function renderResumoPDV() {
  const { subtotal, descontoItens, descTotalReais, acrescimoReais, total } = calcularTotaisPDV();
  document.getElementById("pdvSubtotal").textContent = formatarMoeda(subtotal);
  document.getElementById("pdvDescontoItens").textContent = formatarMoeda(descontoItens);
  document.getElementById("pdvDescontoTotalView").textContent = formatarMoeda(descTotalReais);
  document.getElementById("pdvAcrescimoView").textContent = formatarMoeda(acrescimoReais);
  document.getElementById("pdvTotalGeral").textContent = formatarMoeda(total);

  const valorRecebido = parseFloat(document.getElementById("pdvValorRecebido")?.value) || 0;
  const troco = valorRecebido - total;
  const trocoEl = document.getElementById("pdvTroco");
  if (trocoEl) {
    trocoEl.textContent = formatarMoeda(Math.max(0, troco));
    trocoEl.style.color = troco < 0 ? "#DC2626" : "#059669";
  }

  if (_splitPagamentos.length && !document.getElementById("pdvSplitBox").hidden) atualizarResumoSplit();
}

// ── Pagamento Múltiplo (split) ───────────────────────────────────
function renderSplitBox() {
  const wrap = document.getElementById("pdvSplitRows");
  if (!wrap) return;
  wrap.innerHTML = _splitPagamentos.map((p, i) => `
    <div class="pdv-split-row" data-split-row="${p.id}">
      <select class="field-input--plain" data-split-forma="${p.id}">
        ${FORMAS_SPLIT.map(f => `<option value="${f}" ${p.forma === f ? "selected" : ""}>${f}</option>`).join("")}
      </select>
      <input type="number" class="field-input--plain" min="0" step="0.01" placeholder="0,00"
        value="${p.valor ? p.valor : ""}" data-split-valor="${p.id}" />
      <button type="button" class="pdv-split-row-remover" data-split-remover="${p.id}" title="Remover" ${_splitPagamentos.length <= 1 ? "disabled" : ""}>×</button>
    </div>`).join("");

  wrap.querySelectorAll("[data-split-forma]").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const id = parseInt(e.target.dataset.splitForma);
      const p = _splitPagamentos.find(x => x.id === id);
      if (p) p.forma = e.target.value;
    });
  });
  wrap.querySelectorAll("[data-split-valor]").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const id = parseInt(e.target.dataset.splitValor);
      const p = _splitPagamentos.find(x => x.id === id);
      if (p) p.valor = parseFloat(e.target.value) || 0;
      atualizarResumoSplit();
    });
  });
  wrap.querySelectorAll("[data-split-remover]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = parseInt(e.target.dataset.splitRemover);
      if (_splitPagamentos.length <= 1) return;
      _splitPagamentos = _splitPagamentos.filter(x => x.id !== id);
      renderSplitBox();
    });
  });

  atualizarResumoSplit();
}

function atualizarResumoSplit() {
  const { subtotal, descontoItens, descTotalReais, acrescimoReais, total } = calcularTotaisPDV();
  const somado = _splitPagamentos.reduce((s, p) => s + (p.valor || 0), 0);
  const restante = Math.round((total - somado) * 100) / 100;
  document.getElementById("pdvSplitTotalVenda").textContent = formatarMoeda(total);
  document.getElementById("pdvSplitSomado").textContent = formatarMoeda(somado);
  const restanteEl = document.getElementById("pdvSplitRestante");
  restanteEl.textContent = formatarMoeda(Math.abs(restante));
  const linhaRestante = restanteEl.closest(".pdv-split-resumo-linha");
  const ok = Math.abs(restante) < 0.01;
  linhaRestante.classList.toggle("pdv-split-ok", ok);
  restanteEl.textContent = ok ? formatarMoeda(0) : (restante > 0 ? `Falta ${formatarMoeda(restante)}` : `Sobrou ${formatarMoeda(Math.abs(restante))}`);
}


function selecionarClienteFiado(cliente) {
  _clienteFiado = cliente;
  document.getElementById("pdvClienteInput").value = cliente.nome;
  document.getElementById("pdvClienteSugestoes").hidden = true;
  document.getElementById("pdvClienteNaoEncontrado").hidden = true;
  const chip = document.getElementById("pdvClienteSelecionado");
  chip.hidden = false;
  chip.innerHTML = `<span>👤 ${escHtml(cliente.nome)}</span><button type="button" id="btnTrocarClienteFiado">trocar</button>`;
  document.getElementById("btnTrocarClienteFiado").onclick = () => {
    _clienteFiado = null;
    document.getElementById("pdvClienteInput").value = "";
    chip.hidden = true;
    document.getElementById("pdvClienteInput").focus();
  };
}

function abrirModalNovoClienteFiado() {
  const nomeDigitado = document.getElementById("pdvClienteInput").value.trim();
  const body = `
    <div class="form-usuario">
      <div>
        <label class="field-label">Nome *</label>
        <input type="text" id="mNovoCliNome" class="field-input--plain" value="${escHtml(nomeDigitado)}" />
      </div>
      <div>
        <label class="field-label">Telefone</label>
        <input type="text" id="mNovoCliTel" class="field-input--plain" placeholder="(00) 00000-0000" />
      </div>
    </div>`;
  window.abrirModal("+ Novo Cliente", body,
    `<button class="btn-ghost" id="btnCancNovoCli">Cancelar</button>
     <button class="btn-primary" id="btnSalvarNovoCli">Salvar e Selecionar</button>`);
  document.getElementById("btnCancNovoCli").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarNovoCli").onclick = async () => {
    const nome = document.getElementById("mNovoCliNome").value.trim();
    if (!nome) { window.mostrarToast("Informe o nome do cliente.", "error"); return; }
    const btn = document.getElementById("btnSalvarNovoCli");
    btn.disabled = true; btn.textContent = "Salvando...";
    try {
      const ref = await addDoc(collection(db, COL_CLI_PROM), {
        nome,
        telefone: document.getElementById("mNovoCliTel").value.trim(),
        observacoes: "",
        criadoEm: serverTimestamp()
      });
      const novoCliente = { id: ref.id, nome };
      _clientesProm.push(novoCliente);
      window.fecharModal();
      selecionarClienteFiado(novoCliente);
      window.mostrarToast("Cliente cadastrado e selecionado!", "success");
    } catch (err) {
      console.error(err);
      window.mostrarToast("Erro ao cadastrar cliente.", "error");
      btn.disabled = false; btn.textContent = "Salvar e Selecionar";
    }
  };
  setTimeout(() => document.getElementById("mNovoCliNome")?.focus(), 50);
}

// ── Histórico (comando H) ───────────────────────────────────────
async function abrirHistoricoVendasPDV() {
  // O Caixa mostra somente o resumo do dia/sessão. O detalhamento permanece em Relatórios.
  try {
    const snap = _sessaoCaixa?.id
      ? await getDocs(query(collection(db, COL_VENDAS), where("sessaoId", "==", _sessaoCaixa.id), limit(100)))
      : await getDocs(query(collection(db, COL_VENDAS), orderBy("criadoEm", "desc"), limit(20)));
    const linhas = [];
    snap.forEach(d => linhas.push({ id: d.id, ...d.data() }));
    linhas.sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    const body = linhas.length
      ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>#</th><th>Hora</th><th>Pagamento</th><th>Cliente</th><th>Operador</th><th>Itens</th><th>Total</th></tr></thead>
          <tbody>${linhas.map(v => {
            const dt = v.data?.toDate?.() || new Date();
            return `<tr><td>#${v.numero || "—"}</td><td>${dt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</td><td>${escHtml(v.formaPagamento||"—")}</td><td>${escHtml(v.clienteFiadoNome||"—")}</td><td>${escHtml(v.operador||"—")}</td><td>${v.itens||0}</td><td><strong>${formatarMoeda(v.total||0)}</strong></td></tr>`;
          }).join("")}</tbody></table></div>`
      : `<p class="empty-cell">Nenhuma venda registrada ainda.</p>`;
    window.abrirModal("Vendas de hoje", body, `<button class="btn-primary" id="btnFecharHist">Fechar</button>`);
    document.getElementById("btnFecharHist").onclick = () => window.fecharModal();
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao carregar histórico.", "error");
  }
}

// ── Cancelar venda (comando C) ───────────────────────────────────
function confirmarCancelarVendaPDV() {
  if (!_itensVenda.length) { window.mostrarToast("Não há itens na venda.", "warning"); return; }
  const body = `<p>Tem certeza que deseja cancelar toda a venda atual? Os itens, descontos, cliente e forma de pagamento serão limpos.</p>`;
  window.abrirModal("Cancelar Venda", body,
    `<button class="btn-ghost" id="btnVoltarCancel">Voltar</button>
     <button class="btn-danger" id="btnConfirmCancel" style="background:#DC2626;color:#fff;border:none;padding:10px 18px;border-radius:var(--radius-md);font-weight:600;cursor:pointer">Cancelar Venda</button>`);
  document.getElementById("btnVoltarCancel").onclick = () => window.fecharModal();
  document.getElementById("btnConfirmCancel").onclick = () => {
    limparVendaPDV();
    window.fecharModal();
    window.mostrarToast("Venda cancelada.", "success");
  };
}

function limparVendaPDV() {
  _itensVenda = [];
  _descontoTotal = { tipo: "rs", valor: 0 };
  _acrescimo = { tipo: "rs", valor: 0 };
  _clienteFiado = null;
  _qtdPendente = 1;
  _splitPagamentos = [];
  document.getElementById("inputDescontoTotal").value = 0;
  document.getElementById("inputAcrescimo").value = 0;
  document.querySelectorAll(".pdv-toggle-btn").forEach(b => b.classList.toggle("pdv-toggle-btn--active", b.dataset.tipo === "rs"));
  document.getElementById("pdvFormaPag").value = "Dinheiro";
  document.getElementById("pdvDinheiroBox").style.display = "grid";
  document.getElementById("pdvPixOrigemBox").hidden = true;
  document.getElementById("pdvPixOrigem").value = "";
  document.getElementById("pdvFiadoBox").hidden = true;
  document.getElementById("pdvSplitBox").hidden = true;
  document.getElementById("pdvSplitRows").innerHTML = "";
  document.getElementById("pdvValorRecebido").value = "";
  document.getElementById("pdvClienteInput").value = "";
  document.getElementById("pdvClienteSelecionado").hidden = true;
  document.getElementById("pdvCpfCnpj").value = "";
  document.getElementById("pdvObservacao").value = "";
  renderItensPDV();
  document.getElementById("terminalInput").value = "";
  document.getElementById("terminalInput").focus();
}

// ── Finalizar venda ──────────────────────────────────────────────
async function finalizarVendaPDV() {
  // A trava acontece antes de qualquer await: clique, Enter e F não reentram.
  if (_isFinalizing) return;
  _isFinalizing = true;
  const btn = document.getElementById("btnFinalizarVendaPDV");
  if (btn) { btn.disabled = true; btn.style.opacity = "0.6"; }

  if (!_itensVenda.length) { window.mostrarToast("Adicione ao menos um produto.", "error"); _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return; }
  const forma = document.getElementById("pdvFormaPag").value;

  if (forma === "Fiado" && !_clienteFiado) {
    window.mostrarToast("Selecione um cliente cadastrado ou clique em \"+ Novo Cliente\".", "error");
    document.getElementById("pdvClienteInput").focus();
    _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return;
  }

  if (forma === "PIX" && !document.getElementById("pdvPixOrigem").value) {
    window.mostrarToast("Informe se o PIX foi pela maquininha ou direto.", "error");
    document.getElementById("pdvPixOrigem").focus();
    _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return;
  }

  const { subtotal, descontoItens, descTotalReais, acrescimoReais, total } = calcularTotaisPDV();
  if (forma === "Dinheiro") {
    const recebido = parseFloat(document.getElementById("pdvValorRecebido").value) || 0;
    if (recebido < total) { window.mostrarToast("Valor recebido insuficiente.", "error"); _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return; }
  }

  let pagamentosSplit = [];
  let formaPagamentoFinal = forma;
  if (forma === "Múltiplo") {
    pagamentosSplit = _splitPagamentos.filter(p => (p.valor || 0) > 0).map(p => ({ forma: p.forma, valor: p.valor }));
    if (!pagamentosSplit.length) { window.mostrarToast("Informe ao menos um valor na divisão de pagamento.", "error"); _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return; }
    const somado = pagamentosSplit.reduce((s, p) => s + p.valor, 0);
    if (Math.abs(somado - total) >= 0.01) {
      window.mostrarToast(somado < total ? "A soma dos pagamentos é menor que o total da venda." : "A soma dos pagamentos ultrapassa o total da venda.", "error");
      _isFinalizing = false; if (btn) { btn.disabled = false; btn.style.opacity = "1"; } return;
    }
    formaPagamentoFinal = pagamentosSplit.map(p => p.forma).join(" + ");
  }

  try {
    const snapCount = await getDocs(collection(db, COL_VENDAS));
    const numero = snapCount.size + 1;

    // O mesmo ID é usado durante toda a tentativa; uma reentrada não cria outra venda.
    _vendaEmFinalizacaoId ||= crypto.randomUUID();
    const vendaRef = doc(db, COL_VENDAS, _vendaEmFinalizacaoId);
    await setDoc(vendaRef, {
      numero,
      data: Timestamp.fromDate(new Date()),
      total,
      itens: _itensVenda.length,
      formaPagamento: formaPagamentoFinal,
      pixOrigem: forma === "PIX" ? document.getElementById("pdvPixOrigem").value : "",
      pagamentos: pagamentosSplit,
      descontoTotal: _descontoTotal,
      acrescimo: _acrescimo,
      cpfCnpj: document.getElementById("pdvCpfCnpj").value.trim(),
      observacoes: document.getElementById("pdvObservacao").value.trim(),
      clienteFiadoId: _clienteFiado?.id || "",
      clienteFiadoNome: _clienteFiado?.nome || "",
      operador: _dadosUsuario?.nome || "—",
      operadorId: _usuarioId,
      sessaoId: _sessaoCaixa?.id || "",
      status: "concluida",
      criadoEm: serverTimestamp()
    });

    await Promise.all(_itensVenda.map(async it => {
      await addDoc(collection(db, COL_ITENS), {
        vendaId: vendaRef.id, produtoId: it.produtoId, nome: it.nome,
        qtd: it.qtd, precoUnit: it.precoUnit,
        desconto: itemDescontoReais(it), total: itemTotal(it)
      });
      const prod = _produtos.find(p => p.id === it.produtoId);
      if (prod) {
        const qtdAntes = prod.estoque || 0;
        const qtdDepois = Math.max(0, qtdAntes - it.qtd);
        await updateDoc(doc(db, COL_PRODUTOS, it.produtoId), { estoque: qtdDepois });
        await addDoc(collection(db, COL_HIST), {
          produtoId: it.produtoId,
          nomeProduto: it.nome,
          tipo: "venda",
          qtdAntes,
          qtdDepois,
          delta: qtdDepois - qtdAntes,
          motivo: `Venda #${numero}`,
          operador: _dadosUsuario?.nome || "—",
          criadoEm: serverTimestamp()
        });
      }
    }));

    if (forma === "Fiado") {
      const descricaoItens = _itensVenda.map(i => `${i.qtd}x ${i.nome}`).join(", ");
      await addDoc(collection(db, COL_COMP_PROM), {
        clienteId: _clienteFiado.id,
        valor: total,
        dataCompra: Timestamp.fromDate(new Date()),
        vencimento: null,
        observacoes: `Venda #${numero} — ${descricaoItens}`,
        vendaId: vendaRef.id,
        criadoEm: serverTimestamp()
      });
    }

    window.mostrarToast(
      forma === "Fiado"
        ? `Venda #${numero} registrada! ${formatarMoeda(total)} somado à dívida de ${_clienteFiado.nome}.`
        : `Venda #${numero} finalizada! Total: ${formatarMoeda(total)}`,
      "success"
    );

    imprimirViasVenda({ numero, subtotal, descontoItens, descontoTotal: descTotalReais, acrescimo: acrescimoReais, total, formaPagamento: formaPagamentoFinal, pixOrigem: forma === "PIX" ? document.getElementById("pdvPixOrigem").value : "", itens: _itensVenda, cpfCnpj: document.getElementById("pdvCpfCnpj").value.trim(), cliente: _clienteFiado?.nome || "", operador: _dadosUsuario?.nome || "—" });

    limparVendaPDV();
    _vendaEmFinalizacaoId = null;
    // Recarrega estoque em memória
    const snapProd = await getDocs(query(collection(db, COL_PRODUTOS), orderBy("nome")));
    _produtos = []; snapProd.forEach(d => _produtos.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    window.mostrarToast("Erro ao finalizar venda.", "error");
  } finally {
    _isFinalizing = false;
    if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
  }
}

function imprimirViasVenda(venda) {
  const data = new Date().toLocaleString("pt-BR");
  const itens = venda.itens.map(item => `<tr><td>${escHtml(item.nome)}<br><small>${item.qtd} × ${formatarMoeda(item.precoUnit)}</small></td><td>${formatarMoeda(itemTotal(item))}</td></tr>`).join("");
  const dadosCliente = venda.cpfCnpj ? `<p>CPF/CNPJ: ${escHtml(venda.cpfCnpj)}</p>` : "";
  const pix = venda.pixOrigem ? `<p>PIX: ${escHtml(venda.pixOrigem)}</p>` : "";
  const ajustes = `${venda.descontoItens ? `<p>Desconto nos itens: -${formatarMoeda(venda.descontoItens)}</p>` : ""}${venda.descontoTotal ? `<p>Desconto total: -${formatarMoeda(venda.descontoTotal)}</p>` : ""}${venda.acrescimo ? `<p>Acréscimo: ${formatarMoeda(venda.acrescimo)}</p>` : ""}`;
  const viaCliente = `<section class="cupom"><h2>VIA DO CLIENTE</h2><p>Venda #${venda.numero} · ${data}</p>${dadosCliente}<table>${itens}</table><hr>${ajustes}<p>Operador: ${escHtml(venda.operador)}</p><p>Pagamento: ${escHtml(venda.formaPagamento)}</p>${pix}<h3>Total: ${formatarMoeda(venda.total)}</h3><footer>Documento sem valor fiscal</footer></section>`;
  const viaLojista = `<section class="cupom quebra"><h2>VIA DO LOJISTA</h2><p>Venda #${venda.numero} · ${data}</p><p>Operador: ${escHtml(venda.operador)}</p><p>Cliente: ${escHtml(venda.cliente || "Não informado")}</p><p>Pagamento: ${escHtml(venda.formaPagamento)}</p>${pix}<table>${itens}</table><hr><p>Subtotal: ${formatarMoeda(venda.subtotal)}</p>${ajustes}<h3>Total: ${formatarMoeda(venda.total)}</h3><footer>Documento sem valor fiscal</footer></section>`;
  imprimirConteudo(`Venda ${venda.numero}`, `${viaCliente}${viaLojista}`);
}

function imprimirConteudo(titulo, conteudo) {
  const janela = window.open("", "_blank", "width=420,height=700");
  if (!janela) {
    window.mostrarToast("Permita pop-ups para imprimir ou salvar o comprovante em PDF.", "warning");
    return;
  }
  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(titulo)}</title><style>@page{size:80mm auto;margin:5mm}body{font:12px monospace;color:#111;margin:0}.cupom{width:70mm}.cupom h2,.cupom h3{text-align:center}.cupom p{margin:5px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right}footer{text-align:center;margin-top:14px;font-size:10px}.quebra{break-before:page;page-break-before:always}</style></head><body>${conteudo}<script>window.onload=()=>window.print();<\/script></body></html>`);
  janela.document.close();
}
