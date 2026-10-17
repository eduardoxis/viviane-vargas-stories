// firebase-config.js — Gerência Viviane Vargas Stories
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Configuração pública do aplicativo web Firebase.
const firebaseConfig = {
  apiKey:            "AIzaSyBR_9BwyZuqFwDBWo3tKDfvNw2gy3ud02w",
  authDomain:        "viviane-vargas-stories.firebaseapp.com",
  projectId:         "viviane-vargas-stories",
  storageBucket:     "viviane-vargas-stories.firebasestorage.app",
  messagingSenderId: "435149100307",
  appId:             "1:435149100307:web:ad341be54acb289df7b6e6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Sessão isolada: cadastrar uma conta não desconecta o administrador atual.
const appCadastro = initializeApp(firebaseConfig, "vv-cadastro-usuarios");
export const authCadastro = getAuth(appCadastro);

export default app;
