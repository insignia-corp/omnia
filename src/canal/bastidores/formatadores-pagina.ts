/**
 * Formatadores da tela de bastidores, em JavaScript puro para rodarem no navegador. A página embute este
 * texto e o teste executa o mesmo texto, então o que se testa é o que a tela usa. Aritmética inteira do
 * começo ao fim (regra inviolável 2): dinheiro em centavos ou microdólares, latência em ms.
 */
export const FORMATADORES_PAGINA = String.raw`
// Centavos inteiros viram "R$ 1.234,56" sem passar por ponto flutuante.
function milhares(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
function reais(centavos) {
  if (centavos === null || centavos === undefined) return "sem valor";
  const sinal = centavos < 0 ? "-" : "";
  const s = String(Math.abs(centavos)).padStart(3, "0");
  return sinal + "R$ " + milhares(s.slice(0, -2)) + "," + s.slice(-2);
}

// Microdólares (USD x 1e6) em "US$ 0,18" (casas = 2) ou "US$ 0,012" (casas = 3), arredondando meio para cima.
function dolares(microdolares, casas) {
  if (microdolares === null || microdolares === undefined) return "sem valor";
  const divisor = 10 ** (6 - casas);
  const unidades = Math.floor((microdolares + divisor / 2) / divisor);
  if (unidades === 0 && microdolares > 0) return "< US$ 0," + "0".repeat(casas - 1) + "1";
  const s = String(unidades).padStart(casas + 1, "0");
  return "US$ " + milhares(s.slice(0, -casas)) + "," + s.slice(-casas);
}

// Milissegundos em "850 ms" ou "4,2 s" (um décimo, meio para cima).
function latencia(ms) {
  if (ms === null || ms === undefined) return "sem dados";
  if (ms < 1000) return ms + " ms";
  const decimos = Math.floor((ms + 50) / 100);
  return milhares(Math.floor(decimos / 10)) + "," + (decimos % 10) + " s";
}

const GATILHOS = {
  mensagem_dono: "mensagem do dono",
  nota_processada: "nota recebida",
  relatorio_diario: "resumo diário",
  extracao_nota: "leitura da nota",
  vinculo_produto: "vínculo de produto",
};
const rotuloGatilho = (g) => GATILHOS[g] || g;

// Cor sempre com texto: verde ok, vermelho erro ou bloqueio, âmbar atenção.
const RESULTADOS = {
  aprovada: { texto: "Enviada", cor: "verde" },
  fallback_verificador: { texto: "Bloqueada", cor: "vermelho" },
  fallback_erro: { texto: "Erro", cor: "vermelho" },
  recusa_modelo: { texto: "Recusada", cor: "ambar" },
};
const GATILHOS_SEM_MENSAGEM = ["extracao_nota", "vinculo_produto"];
function rotuloResultado(resultado, gatilho) {
  const r = RESULTADOS[resultado] || { texto: resultado, cor: "cinza" };
  if (resultado === "aprovada" && GATILHOS_SEM_MENSAGEM.includes(gatilho)) return { texto: "Concluída", cor: "verde" };
  return r;
}

const TIPOS_ALERTA = {
  reajuste_de_custo: "Reajuste de custo",
  margem_abaixo_da_meta: "Margem abaixo da meta",
  espaco_para_subir_preco: "Espaço para subir preço",
  giro_em_alta: "Giro em alta",
  estoque_parado: "Estoque parado",
  ticket_medio_em_queda: "Ticket médio em queda",
  gasto_fora_do_padrao: "Gasto fora do padrão",
};
const rotuloTipoAlerta = (t) => TIPOS_ALERTA[t] || t;

const STATUS_ALERTA = {
  enviado: { texto: "enviado", cor: "verde" },
  candidato: { texto: "candidato", cor: "ambar" },
  descartado: { texto: "descartado", cor: "cinza" },
  obsoleto: { texto: "obsoleto", cor: "cinza" },
};
const rotuloStatusAlerta = (s) => STATUS_ALERTA[s] || { texto: s, cor: "cinza" };

const STATUS_EXTRACAO = {
  extraido: { texto: "Extraída", cor: "verde" },
  revisao: { texto: "Em revisão", cor: "ambar" },
  falha: { texto: "Falha", cor: "vermelho" },
  pendente: { texto: "Na fila", cor: "cinza" },
  processando: { texto: "Processando", cor: "cinza" },
};
const rotuloStatusExtracao = (s) => STATUS_EXTRACAO[s] || { texto: s, cor: "cinza" };
`;
