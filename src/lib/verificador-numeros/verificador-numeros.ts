/**
 * Verificador de números (regra inviolável 8).
 *
 * Extrai todo número de uma mensagem em português e confere se cada um aparece nos
 * resultados das ferramentas daquela execução. Número que não aparece bloqueia o envio.
 *
 * Convenções lidas nos resultados das ferramentas:
 * - chave terminada em `_centavos`: o valor também vale em reais (12990 -> 129,90);
 * - chave terminada em `_percentual`: valor já em pontos percentuais, pronto para exibir;
 * - números dentro de textos (datas "2026-10-15", nomes "Refrigerante 2L") também valem;
 * - identificadores não valem: valor de chave `id`, `*_id`, `*Id` (ou no plural) e UUID dentro de
 *   texto são ignorados, porque os dígitos de um id aleatório não são números que o dono possa ouvir.
 * Ferramentas devem devolver valores já arredondados para exibição. O verificador preserva
 * sinal e valor, sem arredondar. Cardinais por extenso são bloqueados para regerar em algarismos.
 *
 * Única exceção ao sinal: percentual negativo de chave `_percentual` (-7.29) pode ser dito em módulo
 * ("queda de 7,29%", "caiu 7,29%"), porque é assim que o dono fala. Só vale com palavra de direção
 * coerente ao lado do número (ver `direcaoDoPercentual`); sem ela, ou com direção contrária
 * ("alta de 7,29%"), o número é bloqueado. Dinheiro e contagem seguem exigindo o sinal.
 *
 * Este módulo não depende do resto da aplicação.
 */

export interface NumeroEncontrado {
  /** Trecho como aparece na mensagem, ex.: "R$ 1.234,50". */
  texto: string;
  valor: number;
  posicao: number;
}

export interface ResultadoVerificacao {
  aprovado: boolean;
  encontrados: NumeroEncontrado[];
  naoAutorizados: NumeroEncontrado[];
  porExtenso: string[];
}

// Milhar com ponto exige grupos de 3 dígitos; decimal usa vírgula. Hífen entre dígitos
// (datas ISO, intervalos) não é sinal de negativo.
const PADRAO_NUMERO =
  /(?:(?<![\d.,])[-−+]\s*(?:R\$\s*)?|R\$\s*[-−+]?\s*|\bmenos\s+(?:R\$\s*)?)?(?<!\d)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?:\s*%)?/gi;

// Não tentamos interpretar ou calcular expressões por extenso. O modelo deve reescrevê-las
// em algarismos, que passam pela mesma comparação dos demais valores.
const CARDINAIS = new Set(
  (
    "zero um uma dois duas três tres quatro cinco seis sete oito nove dez onze doze treze " +
    "catorze quatorze quinze dezesseis dezasseis dezessete dezassete dezoito dezenove dezanove " +
    "vinte trinta quarenta cinquenta cinqüenta sessenta setenta oitenta noventa cem cento " +
    "duzentos duzentas trezentos trezentas quatrocentos quatrocentas quinhentos quinhentas " +
    "seiscentos seiscentas setecentos setecentas oitocentos oitocentas novecentos novecentas " +
    "mil milhão milhões milhao milhoes bilhão bilhões bilhao bilhoes trilhão trilhões trilhao trilhoes"
  ).split(" "),
);

function encontrarPorExtenso(mensagem: string): string[] {
  const encontrados: string[] = [];
  for (const m of mensagem.matchAll(/\p{L}+/gu)) {
    const palavra = m[0].toLocaleLowerCase("pt-BR");
    if (!CARDINAIS.has(palavra)) continue;
    // "por cento" é unidade; o valor que a antecede é validado separadamente.
    if (palavra === "cento" && /\bpor\s+$/i.test(mensagem.slice(0, m.index))) continue;
    // "um/uma" também são artigos: "uma planilha" não afirma quantidade. Tratamos como
    // numeral quando isolados ou acompanhados de unidade/contagem usada no domínio.
    if (palavra === "um" || palavra === "uma") {
      const depois = mensagem.slice(m.index + m[0].length);
      if (
        !/^\s*(?:$|[.,;:!?])/u.test(depois) &&
        !/^\s+(?:rea(?:l|is)|centavos?|por\s+cento|unidades?|itens?|produtos?|vendas?|compras?|lojas?|dias?|semanas?|m[eê]s(?:es)?|anos?|horas?|minutos?|quilos?|quilogramas?|litros?|vez(?:es)?)\b/i.test(
          depois,
        )
      )
        continue;
    }
    encontrados.push(m[0]);
  }
  return encontrados;
}

export function extrairNumeros(mensagem: string): NumeroEncontrado[] {
  const encontrados: NumeroEncontrado[] = [];
  for (const m of mensagem.matchAll(PADRAO_NUMERO)) {
    const bruto = m[1];
    if (bruto === undefined) continue;
    const sinal = /[-−]|\bmenos\b/i.test(m[0]) ? -1 : 1;
    const valor = sinal * Number(bruto.replace(/\./g, "").replace(",", "."));
    encontrados.push({ texto: m[0].trim(), valor, posicao: m.index });
  }
  return encontrados;
}

type Direcao = "negativa" | "positiva";

// Palavras que dão sentido ao número por si sós; valem em qualquer ponto da oração antes dele.
const DIRECAO_FORTE: Record<Direcao, RegExp> = {
  negativa:
    /\b(?:queda|quedas|caiu|cairam|caíram|cair|caindo|recuo|recuou|recuaram|diminuiu|diminuição|diminuicao|redução|reducao|reduziu|despencou|perda|perdeu|negativ[oa]s?|baixa\s+de|em\s+baixa)\b/giu,
  positiva:
    /\b(?:alta|altas|subiu|subiram|subir|subindo|aumento|aumentou|aumentaram|cresceu|cresceram|crescimento|avanço|avanco|avançou|ganho|positiv[oa]s?)\b/giu,
};

// Comparativos só dão sentido quando colados depois do número: "7,29% menor", "7,29% a menos".
// Antes dele são comparação ("queda maior, de 7,29%") e não dizem o sentido do valor.
const DIRECAO_COLADA: Record<Direcao, RegExp> = {
  negativa:
    /^\s*(?:(?:de|em|a)\s+)?(?:queda|recuo|redução|reducao|menos|menor(?:es)?|abaixo|inferior|inferiores)\b/iu,
  positiva:
    /^\s*(?:(?:de|em|a)\s+)?(?:alta|aumento|crescimento|mais|maior(?:es)?|acima|superior|superiores)\b/iu,
};

const FRONTEIRA_DE_ORACAO = /[.,;:!?\n]|\b(?:mas|por[eé]m|enquanto)\b/giu;
const JANELA_ANTES = 80;

/**
 * Sentido que o texto dá ao número em `[inicio, fim)`: palavra colada logo depois (ou, antes dele, a
 * mais próxima dentro da mesma oração). Sem palavra, devolve null.
 */
function direcaoDoPercentual(mensagem: string, inicio: number, fim: number): Direcao | null {
  const colada = (["negativa", "positiva"] as const).find((d) =>
    DIRECAO_COLADA[d].test(mensagem.slice(fim).replace(PADRAO_NUMERO, " ")),
  );
  if (colada) return colada;
  const antes = mensagem
    .slice(Math.max(0, inicio - JANELA_ANTES), inicio)
    .replace(PADRAO_NUMERO, " ")
    .split(FRONTEIRA_DE_ORACAO)
    .pop() as string;
  let melhor: { direcao: Direcao; fim: number } | null = null;
  for (const direcao of ["negativa", "positiva"] as const) {
    for (const m of antes.matchAll(DIRECAO_FORTE[direcao])) {
      const f = m.index + m[0].length;
      if (melhor === null || f > melhor.fim) melhor = { direcao, fim: f };
    }
  }
  return melhor?.direcao ?? null;
}

const chave = (n: number): string => n.toString();

/** Chave que guarda identificador: `id`, `produto_id`, `alertaId`, `alerta_ids`, `ids`. */
const CHAVE_DE_ID = /(?:^|_)ids?$|[a-z]Ids?$/;

/** UUID em qualquer posição do texto. */
const UUID_NO_TEXTO = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Conjunto de valores que a mensagem pode citar, derivado dos resultados das ferramentas. */
export class NumerosAutorizados {
  private readonly valores = new Set<string>();
  /** Módulo dos percentuais negativos (chave `_percentual`), que podem ser ditos com palavra de direção. */
  private readonly quedasPercentuais = new Set<string>();

  constructor(fontes: unknown[] = [], extras: number[] = []) {
    for (const f of fontes) this.adicionarFonte(f);
    for (const n of extras) this.adicionar(n);
  }

  adicionar(n: number): void {
    if (Number.isFinite(n)) this.valores.add(chave(n));
  }

  adicionarFonte(fonte: unknown, nomeChave = ""): void {
    // Id é identificador, não número da mensagem: nem os dígitos de um UUID nem um id numérico valem.
    if (CHAVE_DE_ID.test(nomeChave)) return;
    if (typeof fonte === "number") {
      this.adicionar(fonte);
      if (fonte < 0 && nomeChave.endsWith("_percentual")) this.quedasPercentuais.add(chave(-fonte));
      if (nomeChave.endsWith("_centavos") && Number.isInteger(fonte)) this.adicionar(fonte / 100);
    } else if (typeof fonte === "string") {
      for (const n of extrairNumerosDeTexto(fonte.replace(UUID_NO_TEXTO, " "))) this.adicionar(n);
    } else if (Array.isArray(fonte)) {
      for (const item of fonte) this.adicionarFonte(item, nomeChave);
    } else if (fonte !== null && typeof fonte === "object") {
      for (const [k, v] of Object.entries(fonte)) this.adicionarFonte(v, k);
    }
  }

  contem(n: number): boolean {
    return this.valores.has(chave(n));
  }

  /** O valor, positivo, é o módulo de um percentual negativo devolvido por ferramenta. */
  contemQuedaPercentual(modulo: number): boolean {
    return modulo > 0 && this.quedasPercentuais.has(chave(modulo));
  }
}

function extrairNumerosDeTexto(texto: string): number[] {
  // Textos vindos de ferramentas podem usar ponto decimal ("1.5") ou formato brasileiro.
  const nums = extrairNumeros(texto).map((e) => e.valor);
  for (const m of texto.matchAll(/(?<![\d.,])[-−+]?\d+\.\d+(?![\d.,])/g)) {
    nums.push(Number(m[0].replace("−", "-")));
  }
  return nums;
}

/** "queda de 7,29%" para -7.29: percentual sem sinal escrito, com palavra de direção negativa. */
function autorizadoPorDirecao(mensagem: string, e: NumeroEncontrado, autorizados: NumerosAutorizados): boolean {
  if (e.valor <= 0 || !e.texto.endsWith("%") || /^[+]|R\$/.test(e.texto)) return false;
  if (!autorizados.contemQuedaPercentual(e.valor)) return false;
  return direcaoDoPercentual(mensagem, e.posicao, e.posicao + e.texto.length) === "negativa";
}

export function verificarNumeros(mensagem: string, autorizados: NumerosAutorizados): ResultadoVerificacao {
  const encontrados = extrairNumeros(mensagem);
  const naoAutorizados = encontrados.filter(
    (e) => !autorizados.contem(e.valor) && !autorizadoPorDirecao(mensagem, e, autorizados),
  );
  const porExtenso = encontrarPorExtenso(mensagem);
  return {
    aprovado: naoAutorizados.length === 0 && porExtenso.length === 0,
    encontrados,
    naoAutorizados,
    porExtenso,
  };
}
