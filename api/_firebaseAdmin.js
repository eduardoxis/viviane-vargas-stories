// Firebase Admin fica apenas no servidor. Nunca coloque a chave privada no frontend.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function chavePrivada(valor) {
  return String(valor || "").trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
}

function appAdmin() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = chavePrivada(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    const erro = new Error("Variáveis do Firebase Admin não configuradas na Vercel.");
    erro.status = 500;
    throw erro;
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function obterDbAdmin() {
  return getFirestore(appAdmin());
}
