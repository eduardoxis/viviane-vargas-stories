import { auth } from "./services/firebase-config.js";
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const form = document.getElementById("formLogin");
const emailInput = document.getElementById("loginEmail");
const senhaInput = document.getElementById("loginSenha");
const erro = document.getElementById("loginErro");
const btnEntrar = document.getElementById("btnEntrar");

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.hidden = false;
}

const mensagemPendente = sessionStorage.getItem("vv_login_erro");
if (mensagemPendente) {
  sessionStorage.removeItem("vv_login_erro");
  mostrarErro(mensagemPendente);
}

onAuthStateChanged(auth, (usuario) => {
  if (usuario) window.location.replace("./index.html");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const senha = senhaInput.value;

  if (!email || !senha) {
    mostrarErro("Preencha e-mail e senha.");
    return;
  }

  erro.hidden = true;
  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";

  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (error) {
    const mensagens = {
      "auth/user-not-found": "Usuário não encontrado.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
      "auth/invalid-credential": "E-mail ou senha incorretos."
    };
    mostrarErro(mensagens[error.code] || "Não foi possível entrar. Tente novamente.");
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";
  }
});
