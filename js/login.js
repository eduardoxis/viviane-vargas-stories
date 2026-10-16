import { auth } from "./services/firebase-config.js";
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const form = document.getElementById("formLogin");
const emailInput = document.getElementById("loginEmail");
const senhaInput = document.getElementById("loginSenha");
const erro = document.getElementById("loginErro");
const btnEntrar = document.getElementById("btnEntrar");
const CHAVE_TENTATIVAS = "vv_login_tentativas";
const MAX_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.hidden = false;
}

function lerControleTentativas() {
  try {
    const controle = JSON.parse(localStorage.getItem(CHAVE_TENTATIVAS) || "{}");
    const agora = Date.now();
    const tentativas = Array.isArray(controle.tentativas)
      ? controle.tentativas.filter((data) => agora - data < JANELA_TENTATIVAS_MS)
      : [];
    return { tentativas, bloqueadoAte: Number(controle.bloqueadoAte) || 0 };
  } catch {
    return { tentativas: [], bloqueadoAte: 0 };
  }
}

function salvarControleTentativas(controle) {
  localStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify(controle));
}

function bloqueioAtivo() {
  const controle = lerControleTentativas();
  return controle.bloqueadoAte > Date.now() ? controle.bloqueadoAte : 0;
}

function mostrarBloqueio(bloqueadoAte) {
  const minutos = Math.max(1, Math.ceil((bloqueadoAte - Date.now()) / 60000));
  mostrarErro(`Muitas tentativas. Aguarde ${minutos} minuto${minutos > 1 ? "s" : ""} para tentar novamente.`);
  btnEntrar.disabled = true;
  btnEntrar.textContent = "Aguarde";
  window.setTimeout(() => {
    if (!bloqueioAtivo()) {
      erro.hidden = true;
      btnEntrar.disabled = false;
      btnEntrar.textContent = "Entrar";
    }
  }, Math.max(0, bloqueadoAte - Date.now()) + 100);
}

function registrarFalha() {
  const agora = Date.now();
  const controle = lerControleTentativas();
  controle.tentativas.push(agora);
  if (controle.tentativas.length >= MAX_TENTATIVAS) {
    controle.tentativas = [];
    controle.bloqueadoAte = agora + BLOQUEIO_MS;
  }
  salvarControleTentativas(controle);
  return controle.bloqueadoAte;
}

function limparTentativas() {
  localStorage.removeItem(CHAVE_TENTATIVAS);
}

// O e-mail nunca aceita caracteres usados em tags ou atributos HTML.
emailInput.addEventListener("input", () => {
  emailInput.value = emailInput.value.replace(/[<>"'`]/g, "").trimStart();
});

const mensagemPendente = sessionStorage.getItem("vv_login_erro");
if (mensagemPendente) {
  sessionStorage.removeItem("vv_login_erro");
  mostrarErro(mensagemPendente);
}

const bloqueioInicial = bloqueioAtivo();
if (bloqueioInicial) mostrarBloqueio(bloqueioInicial);

onAuthStateChanged(auth, (usuario) => {
  if (usuario) window.location.replace("./index.html");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const senha = senhaInput.value;

  const bloqueadoAte = bloqueioAtivo();
  if (bloqueadoAte) {
    mostrarBloqueio(bloqueadoAte);
    return;
  }

  if (!email || !senha || !/^\S+@\S+\.\S+$/.test(email)) {
    mostrarErro("Informe um e-mail válido e a senha.");
    return;
  }

  erro.hidden = true;
  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    limparTentativas();
  } catch (error) {
    const mensagens = {
      "auth/user-not-found": "Usuário não encontrado.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
      "auth/invalid-credential": "E-mail ou senha incorretos."
    };
    const contaComoFalha = [
      "auth/user-not-found", "auth/wrong-password", "auth/invalid-email",
      "auth/invalid-credential", "auth/too-many-requests"
    ].includes(error.code);
    const novoBloqueio = contaComoFalha ? registrarFalha() : 0;
    if (novoBloqueio) {
      mostrarBloqueio(novoBloqueio);
      return;
    }
    mostrarErro(mensagens[error.code] || "Não foi possível entrar. Tente novamente.");
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";
  }
});
