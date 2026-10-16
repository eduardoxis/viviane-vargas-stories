// database.js — Gerência Viviane Vargas Stories
// Utilitários compartilhados entre módulos

export function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(valor) || 0);
}

export function formatarData(timestamp) {
  if (!timestamp) return "—";
  const d = timestamp?.toDate?.() || new Date(timestamp);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Exporta um array de linhas (array de arrays, primeira linha = cabeçalho) para .xlsx
export function exportarExcel(nomeArquivo, linhasAoA) {
  if (!window.XLSX) {
    window.mostrarToast?.("Biblioteca de Excel ainda carregando, tente novamente.", "error");
    return false;
  }
  try {
    const ws = window.XLSX.utils.aoa_to_sheet(linhasAoA);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Dados");
    window.XLSX.writeFile(wb, nomeArquivo.endsWith(".xlsx") ? nomeArquivo : `${nomeArquivo}.xlsx`);
    return true;
  } catch (err) {
    console.error(err);
    window.mostrarToast?.("Erro ao gerar arquivo Excel.", "error");
    return false;
  }
}

export function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
