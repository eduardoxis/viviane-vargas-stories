
import { auth, db }    from "./services/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { formatarMoeda, escHtml } from "./utils/database.js";
import { iniciarProdutos }    from "./modules/produtos.js";
import { iniciarClientes }    from "./modules/clientes.js";
import { iniciarPromissoria } from "./modules/promissoria.js";
import { iniciarCompras }     from "./modules/compras.js";
import { iniciarDespesas }    from "./modules/despesas.js";
import { iniciarCaixa }       from "./modules/caixa.js";
import { iniciarVendas }      from "./modules/vendas.js";
import { iniciarRelatorios }  from "./modules/relatorios.js";
import { requisitarApiAdmin } from "./services/api.js";

// ── Globais necessários ────────────────────────────────────────
window.abrirModal = function(titulo, bodyHTML, footerHTML = "") {
  document.getElementById("modalTitulo").textContent = titulo;
  document.getElementById("modalBody").innerHTML     = bodyHTML;
  document.getElementById("modalFooter").innerHTML   = footerHTML;
  document.getElementById("modalBackdrop").style.display = "flex";
  document.body.style.overflow = "hidden";
};
window.fecharModal = function() {
  document.getElementById("modalBackdrop").style.display = "none";
  document.body.style.overflow = "";
};
window.mostrarToast = function(msg, tipo = "success", dur = 4000) {
  const c = document.getElementById("toastContainer");
  const icons = {
    success: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`,
    error:   `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
    warning: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`
  };
  const t = document.createElement("div");
  const id = `t${Date.now()}`;
  t.id = id; t.className = `toast toast--${tipo}`;
  t.innerHTML = `<span class="toast-icon">${icons[tipo]||icons.success}</span><span class="toast-msg">${msg}</span><button class="toast-close">×</button>`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add("toast--show"));
  const rm = () => { t.classList.remove("toast--show"); setTimeout(() => t.remove(), 300); };
  t.querySelector(".toast-close").addEventListener("click", rm);
  setTimeout(rm, dur);
};

// ── Modal fechar ───────────────────────────────────────────────
document.getElementById("btnFecharModal").addEventListener("click", window.fecharModal);
document.getElementById("modalBackdrop").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modalBackdrop")) window.fecharModal();
});

// ── Toggle valores ─────────────────────────────────────────────
(function() {
  const btn = document.getElementById("btnToggleValores");
  const KEY = "vv_valores_ocultos";
  const SVG_ON  = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>`;
  const SVG_OFF = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>`;
  const set = (oculto) => {
    document.body.classList.toggle("valores-ocultos", oculto);
    btn.innerHTML = oculto ? SVG_OFF : SVG_ON;
    btn.title = oculto ? "Mostrar valores" : "Ocultar valores";
  };
  set(localStorage.getItem(KEY) === "1");
  btn.addEventListener("click", () => {
    const novo = !document.body.classList.contains("valores-ocultos");
    set(novo); localStorage.setItem(KEY, novo ? "1" : "0");
  });
})();

// ── Navegação ──────────────────────────────────────────────────
const titulos = {
  dashboard: "Dashboard", produtos: "Produtos / Estoque",
  clientes: "Clientes", promissoria: "Promissórias", configuracoes: "Configurações",
  vendas: "Vendas", compras: "Compras", despesas: "Despesas", caixa: "Caixa", relatorios: "Relatórios"
};

function navegar(pageId) {
  document.querySelectorAll(".page").forEach(p => {
    p.hidden = true; p.classList.remove("page--active");
  });
  const target = document.getElementById("page-" + pageId);
  if (target) { target.hidden = false; target.classList.add("page--active"); }

  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("nav-item--active"));
  document.querySelectorAll(`[data-page="${pageId}"]`).forEach(el => {
    if (el.classList.contains("nav-item")) el.classList.add("nav-item--active");
  });

  document.querySelectorAll(".mobile-nav-item").forEach(el => {
    el.classList.toggle("mobile-nav-item--active", el.dataset.page === pageId);
  });

  document.getElementById("topbarTitle").textContent = titulos[pageId] || pageId;
  fecharSidebar();
  document.dispatchEvent(new CustomEvent("navegacao", { detail: { page: pageId } }));
}
window.navegar = navegar;

// Cliques em [data-page]
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-page]");
  if (el && !el.classList.contains("nav-item-admin-disabled")) {
    e.preventDefault();
    navegar(el.dataset.page);
  }
});

// ── Sidebar mobile ─────────────────────────────────────────────
function fecharSidebar() {
  document.getElementById("sidebar").classList.remove("sidebar--open");
  document.getElementById("sidebarOverlay").classList.remove("overlay--visible");
}
document.getElementById("btnAbrirSidebar").addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("sidebar--open");
  document.getElementById("sidebarOverlay").classList.add("overlay--visible");
});
document.getElementById("btnFecharSidebar").addEventListener("click", fecharSidebar);
document.getElementById("sidebarOverlay").addEventListener("click", fecharSidebar);

// ── Logout ─────────────────────────────────────────────────────
document.getElementById("btnLogout").addEventListener("click", async () => {
  await signOut(auth);
});

// ── Auth state ─────────────────────────────────────────────────
let _usuario = null, _dadosUsuario = null, _modulosIniciados = false;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    _usuario = user;
    document.getElementById("appShell").hidden = false;

    try {
      const snap = await getDoc(doc(db, "vv_usuarios", user.uid));
      if (snap.exists()) {
        _dadosUsuario = snap.data();
      } else {
        sessionStorage.setItem("vv_login_erro", "Seu acesso ainda não foi liberado por um administrador.");
        await signOut(auth);
        return;
      }
    } catch (err) {
      console.error("Erro ao buscar dados do usuário:", err);
      sessionStorage.setItem("vv_login_erro", "Não foi possível validar o seu acesso. Tente novamente.");
      await signOut(auth);
      return;
    }

    if (_dadosUsuario.ativo === false) {
      sessionStorage.setItem("vv_login_erro", "Esta conta está inativa. Fale com um administrador.");
      await signOut(auth);
      return;
    }

    try {
      await setDoc(doc(db, "vv_usuarios", user.uid), { ultimoLoginEm: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.error("Erro ao registrar último acesso:", err);
    }

    // Atualizar UI
    const nome  = _dadosUsuario.nome || user.email;
    const role  = _dadosUsuario.role || "funcionario";
    document.getElementById("userName").textContent   = nome;
    document.getElementById("userRole").textContent   = role === "admin" ? "Administrador" : "Funcionário";
    document.getElementById("userAvatar").textContent = nome.charAt(0).toUpperCase();

    // Exibir itens admin
    if (role === "admin") {
      document.querySelectorAll(".nav-item-admin").forEach(el => el.hidden = false);
      document.getElementById("dashAdminCards").hidden      = false;
      document.getElementById("dashFuncionarioCards").hidden = true;
    } else {
      document.getElementById("dashAdminCards").hidden      = true;
      document.getElementById("dashFuncionarioCards").hidden = false;
    }

    // Iniciar módulos (uma única vez)
    if (!_modulosIniciados) {
      _modulosIniciados = true;
      iniciarProdutos(user, _dadosUsuario);
      iniciarClientes(user, _dadosUsuario);
      iniciarPromissoria(user, _dadosUsuario);
      iniciarCompras(user, _dadosUsuario);
      iniciarDespesas(user, _dadosUsuario);
      iniciarCaixa(user, _dadosUsuario);
      iniciarVendas(user, _dadosUsuario);
      iniciarRelatorios(user, _dadosUsuario);
      iniciarConfiguracoes(user, _dadosUsuario);
    }

    navegar("dashboard");
    carregarDashboard(role);

  } else {
    _usuario = null; _dadosUsuario = null; _modulosIniciados = false;
    window.location.replace("./login.html");
  }
});

// ── Dashboard ──────────────────────────────────────────────────
async function carregarDashboard(role) {
  try {
    const [prodSnap, cliSnap, compSnap, pagSnap] = await Promise.all([
      getDocs(collection(db, "vv_produtos")),
      role === "admin" ? getDocs(collection(db, "vv_clientes")) : Promise.resolve({ size: 0 }),
      role === "admin" ? getDocs(collection(db, "prom_compras")) : Promise.resolve({ forEach: ()=>{} }),
      role === "admin" ? getDocs(collection(db, "prom_pagamentos")) : Promise.resolve({ forEach: ()=>{} })
    ]);

    // ── Alertas de estoque ──────────────────────────────────
    const alertasEstoqueCritico = [];  // estoque = 0
    const alertasEstoqueBaixo   = [];  // estoque > 0 mas <= mínimo

    let abaixoMinimo = 0;
    prodSnap.forEach(d => {
      const p = { id: d.id, ...d.data() };
      const estoque = p.estoque ?? 0;
      const minimo  = p.estoqueMinimo ?? 0;

      // Estoque
      if (estoque === 0) {
        alertasEstoqueCritico.push(p);
        abaixoMinimo++;
      } else if (minimo > 0 && estoque <= minimo) {
        alertasEstoqueBaixo.push(p);
        abaixoMinimo++;
      }
    });

    renderAlertas({ alertasEstoqueCritico, alertasEstoqueBaixo });

    // ── KPIs ────────────────────────────────────────────────
    const el = id => document.getElementById(id);
    if (el("dashTotalProdutos"))  el("dashTotalProdutos").textContent  = prodSnap.size;
    if (el("dashFuncProdutos"))   el("dashFuncProdutos").textContent   = prodSnap.size;
    if (el("dashFuncBaixo"))      el("dashFuncBaixo").textContent      = abaixoMinimo;

    if (role === "admin") {
      if (el("dashTotalClientes")) el("dashTotalClientes").textContent = cliSnap.size;
      let totalV = 0, totalP = 0, inad = 0;
      const saldoMap = {};
      const agora = new Date();
      compSnap.forEach(d => {
        const c = d.data();
        totalV += c.valor || 0;
        if (!saldoMap[c.clienteId]) saldoMap[c.clienteId] = { c:0, p:0, v:false };
        saldoMap[c.clienteId].c += c.valor || 0;
        if (c.vencimento) { const vd = c.vencimento.toDate?.() || new Date(c.vencimento); if (vd<agora) saldoMap[c.clienteId].v=true; }
      });
      pagSnap.forEach(d => {
        const p = d.data();
        totalP += p.valor || 0;
        if (!saldoMap[p.clienteId]) saldoMap[p.clienteId] = { c:0, p:0, v:false };
        saldoMap[p.clienteId].p += p.valor || 0;
      });
      Object.values(saldoMap).forEach(s => { if (s.c-s.p > 0 && s.v) inad++; });
      if (el("dashTotalAberto"))    el("dashTotalAberto").textContent    = formatarMoeda(Math.max(0, totalV-totalP));
      if (el("dashInadimplentes"))  el("dashInadimplentes").textContent  = inad;
    }
  } catch (err) { console.error("Erro no dashboard:", err); }
}

function renderAlertas({ alertasEstoqueCritico, alertasEstoqueBaixo }) {
  const cont = document.getElementById("dashAlertas");
  if (!cont) return;

  const blocos = [];

  // ── Estoque zerado ───────────────────────────────────────
  if (alertasEstoqueCritico.length) {
    blocos.push(criarBlocoAlerta({
      cor: "vermelho",
      icone: "🚫",
      titulo: `${alertasEstoqueCritico.length} produto${alertasEstoqueCritico.length>1?"s":""} sem estoque`,
      subtitulo: "Esses produtos não podem mais ser vendidos.",
      itens: alertasEstoqueCritico,
      renderItem: p => `<span class="dash-alerta-item"><strong>${escHtml(p.nome)}</strong> — estoque: 0${p.estoqueMinimo>0?" · mínimo: "+p.estoqueMinimo:""}</span>`
    }));
  }

  // ── Estoque abaixo do mínimo ─────────────────────────────
  if (alertasEstoqueBaixo.length) {
    blocos.push(criarBlocoAlerta({
      cor: "laranja",
      icone: "📦",
      titulo: `${alertasEstoqueBaixo.length} produto${alertasEstoqueBaixo.length>1?"s":""} com estoque abaixo do mínimo`,
      subtitulo: "Solicite reposição em breve.",
      itens: alertasEstoqueBaixo,
      renderItem: p => `<span class="dash-alerta-item"><strong>${escHtml(p.nome)}</strong> — estoque: ${p.estoque} · mínimo: ${p.estoqueMinimo}</span>`
    }));
  }

  if (!blocos.length) {
    cont.style.display = "none";
    return;
  }

  cont.style.display = "flex";
  cont.innerHTML = blocos.join("");

  // Colapsar/expandir ao clicar no header
  cont.querySelectorAll(".dash-alerta-header").forEach(header => {
    header.addEventListener("click", () => {
      const bloco = header.closest(".dash-alerta-bloco");
      bloco.classList.toggle("dash-alerta-bloco--collapsed");
    });
  });

  // Botão "Ver em Produtos"
  cont.querySelectorAll("[data-ir-produtos]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); window.navegar("produtos"); });
  });
}

function criarBlocoAlerta({ cor, icone, titulo, subtitulo, itens, renderItem }) {
  const MAX_VISIVEIS = 5;
  const visiveis = itens.slice(0, MAX_VISIVEIS);
  const restantes = itens.length - MAX_VISIVEIS;
  return `
    <div class="dash-alerta-bloco dash-alerta-bloco--${cor}">
      <div class="dash-alerta-header">
        <div class="dash-alerta-header-left">
          <span class="dash-alerta-icone">${icone}</span>
          <div>
            <strong class="dash-alerta-titulo">${titulo}</strong>
            <span class="dash-alerta-subtitulo">${subtitulo}</span>
          </div>
        </div>
        <div class="dash-alerta-header-right">
          <button class="btn-ghost btn-ghost--sm" data-ir-produtos title="Ver em Produtos">Ver produtos →</button>
          <span class="dash-alerta-chevron">▾</span>
        </div>
      </div>
      <div class="dash-alerta-body">
        <div class="dash-alerta-lista">
          ${visiveis.map(p => `<div class="dash-alerta-row">${renderItem(p)}</div>`).join("")}
          ${restantes > 0 ? `<div class="dash-alerta-row dash-alerta-row--mais">+ ${restantes} produto${restantes>1?"s":""} — clique em "Ver produtos" para ver todos</div>` : ""}
        </div>
      </div>
    </div>`;
}


// ── Configurações (usuários) ───────────────────────────────────
function iniciarConfiguracoes(usuario, dadosUsuario) {
  document.addEventListener("navegacao", async (e) => {
    if (e.detail.page === "configuracoes") {
      if (dadosUsuario?.role !== "admin") {
        window.navegar("dashboard");
        window.mostrarToast("Acesso restrito a administradores.", "error");
        return;
      }
      carregarUsuarios();
    }
  });

  document.getElementById("btnNovoUsuario")?.addEventListener("click", abrirModalNovoUsuario);

  document.getElementById("tbodyUsuarios")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "excluir-usuario") confirmarExcluirUsuario(btn.dataset.id, btn.dataset.nome);
    if (btn.dataset.action === "alternar-usuario") alternarStatusUsuario(btn.dataset.id, btn.dataset.ativo === "true");
  });
}

async function carregarUsuarios() {
  const tbody = document.getElementById("tbodyUsuarios");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Carregando...</td></tr>`;
  try {
    const snap = await getDocs(collection(db, "vv_usuarios"));
    if (!snap.size) { tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Nenhum usuário cadastrado.</td></tr>`; return; }
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a,b) => (a.nome||"").localeCompare(b.nome||""));
    tbody.innerHTML = rows.map(u => {
      const ativo = u.ativo !== false;
      const criadoEm = u.criadoEm?.toDate?.()?.toLocaleDateString("pt-BR") || "—";
      const ultimoLogin = u.ultimoLoginEm?.toDate?.()?.toLocaleString("pt-BR") || "Nunca acessou";
      return `
      <tr>
        <td><strong style="color:var(--gray-800)">${u.nome || "—"}</strong></td>
        <td style="color:var(--gray-500)">${u.email || "—"}</td>
        <td><span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:9999px;font-size:0.75rem;font-weight:600;background:${u.role==="admin"?"#F7EEDF":"#D1FAE5"};color:${u.role==="admin"?"#715338":"#065F46"}">${u.role==="admin"?"Administrador":"Funcionário"}</span></td>
        <td><span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:9999px;font-size:0.75rem;font-weight:600;background:${ativo?"#D1FAE5":"#FEE2E2"};color:${ativo?"#065F46":"#991B1B"}">${ativo?"Ativo":"Inativo"}</span></td>
        <td style="color:var(--gray-400);font-size:var(--text-sm)">${criadoEm}</td>
        <td style="color:var(--gray-400);font-size:var(--text-sm)">${ultimoLogin}</td>
        <td class="col-center">
          <button class="btn-table-action" data-action="alternar-usuario" data-id="${u.id}" data-ativo="${ativo}" title="${ativo ? "Desativar" : "Ativar"} usuário">${ativo ? "⏸" : "▶"}</button>
          <button class="btn-table-action btn-table-action--delete" data-action="excluir-usuario" data-id="${u.id}" data-nome="${u.nome||""}" title="Excluir">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
          </button>
        </td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Erro ao carregar usuários.</td></tr>`;
  }
}

function abrirModalNovoUsuario() {
  window.abrirModal("Novo Usuário", `
    <div class="form-usuario">
      <p style="font-size:var(--text-sm);color:var(--gray-500);padding:8px;background:var(--blue-50);border-radius:var(--radius-md)">
        ℹ️ A conta e o perfil de acesso serão criados automaticamente. O UID do Firebase não precisa ser informado.
      </p>
      <div><label class="field-label">Nome *</label>
        <input type="text" id="mUsuNome" class="field-input--plain" placeholder="Nome do usuário" maxlength="100" autocomplete="name" /></div>
      <div><label class="field-label">E-mail *</label>
        <input type="email" id="mUsuEmail" class="field-input--plain" placeholder="email@exemplo.com" maxlength="254" autocomplete="email" /></div>
      <div><label class="field-label">Senha inicial *</label>
        <input type="password" id="mUsuSenha" class="field-input--plain" placeholder="Mínimo de 6 caracteres" minlength="6" maxlength="128" autocomplete="new-password" /></div>
      <div><label class="field-label">Cargo</label>
        <select id="mUsuRole" class="field-input--plain">
          <option value="funcionario">Funcionário</option>
          <option value="admin">Administrador</option>
        </select></div>
    </div>`,
    `<button class="btn-ghost" id="btnCancUsu">Cancelar</button>
     <button class="btn-primary" id="btnSalvarUsu">Registrar Usuário</button>`);

  document.getElementById("btnCancUsu").onclick = () => window.fecharModal();
  document.getElementById("btnSalvarUsu").onclick = salvarNovoUsuario;
  document.getElementById("mUsuNome").focus();
}

async function salvarNovoUsuario() {
  const nome  = document.getElementById("mUsuNome").value.trim();
  const email = document.getElementById("mUsuEmail").value.trim();
  const senha = document.getElementById("mUsuSenha").value;
  const role  = document.getElementById("mUsuRole").value;

  if (!nome || !email || !senha) { window.mostrarToast("Preencha todos os campos obrigatórios.", "error"); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { window.mostrarToast("Informe um e-mail válido.", "error"); return; }
  if (senha.length < 6) { window.mostrarToast("A senha inicial deve ter ao menos 6 caracteres.", "error"); return; }
  const btn = document.getElementById("btnSalvarUsu");
  btn.disabled = true; btn.textContent = "Criando...";
  try {
    await requisitarApiAdmin("/api/usuarios", {
      method: "POST",
      body: JSON.stringify({ nome, email, senha, role })
    });
    window.fecharModal();
    window.mostrarToast("Usuário criado e liberado para acessar.", "success");
    carregarUsuarios();
  } catch (err) {
    window.mostrarToast(err.message || "Não foi possível criar o usuário.", "error");
    btn.disabled = false; btn.textContent = "Registrar Usuário";
  }
}

async function alternarStatusUsuario(id, ativoAtual) {
  if (id === _usuario?.uid && ativoAtual) {
    window.mostrarToast("Você não pode desativar a própria conta.", "error");
    return;
  }
  try {
    await setDoc(doc(db, "vv_usuarios", id), {
      ativo: !ativoAtual,
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    window.mostrarToast(ativoAtual ? "Usuário desativado." : "Usuário ativado.", "success");
    carregarUsuarios();
  } catch (err) {
    console.error("Erro ao alterar status do usuário:", err);
    window.mostrarToast("Erro ao alterar o status do usuário.", "error");
  }
}

function confirmarExcluirUsuario(id, nome) {
  window.abrirModal("Excluir Usuário",
    `<div class="delete-warning"><strong>⚠️ Confirmar exclusão</strong>O usuário <strong>${nome}</strong> será removido do sistema.</div>`,
    `<button class="btn-ghost" id="btnCancUsu">Cancelar</button>
     <button class="btn-danger" id="btnConfExcUsu">Excluir</button>`);
  document.getElementById("btnCancUsu").onclick = () => window.fecharModal();
  document.getElementById("btnConfExcUsu").onclick = async () => {
    const btn = document.getElementById("btnConfExcUsu");
    btn.disabled = true; btn.textContent = "Excluindo...";
    try {
      const { deleteDoc: del, doc: d } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      await del(d(db, "vv_usuarios", id));
      window.fecharModal();
      window.mostrarToast("Usuário excluído.", "success");
      carregarUsuarios();
    } catch (err) {
      window.mostrarToast("Erro ao excluir.", "error");
      btn.disabled = false; btn.textContent = "Excluir";
    }
  };
}
