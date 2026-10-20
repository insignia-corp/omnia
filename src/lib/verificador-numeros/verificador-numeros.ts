/**
 * Verificador de números (regra inviolável 8).
 *
 * Extrai todo número de uma mensagem em português e confere se cada um aparece nos
 * resultados das ferramentas daquela execução. Número que não aparece bloqueia o envio.
 *
 * Convenções lidas nos resultados das ferramentas:
 * - chave terminada em `_centavos`: o valor também vale em reais (12990 -> 129,90);
 * - chave terminada em `_percentual`: valor já em pontos percentuais, pronto para exibir;
 * - números dentro de textos (datas "2026-10-15", nomes "Refrigerante 2L") também valem.
 * Ferramentas devem devolver valores já arredondados para exibição. O verificador preserva
 * sinal e valor, sem arredondar. Cardinais por extenso são bloqueados para regerar em algarismos.
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

const chave = (n: number): string => n.toString();

/** Conjunto de valores que a mensagem pode citar, derivado dos resultados das ferramentas. */
export class NumerosAutorizados {
  private readonly valores = new Set<string>();

  constructor(fontes: unknown[] = [], extras: number[] = []) {
    for (const f of fontes) this.adicionarFonte(f);
    for (const n of extras) this.adicionar(n);
  }

  adicionar(n: number): void {
    if (Number.isFinite(n)) this.valores.add(chave(n));
  }

  adicionarFonte(fonte: unknown, nomeChave = ""): void {
    if (typeof fonte === "number") {
      this.adicionar(fonte);
      if (nomeChave.endsWith("_centavos") && Number.isInteger(fonte)) this.adicionar(fonte / 100);
    } else if (typeof fonte === "string") {
      for (const n of extrairNumerosDeTexto(fonte)) this.adicionar(n);
    } else if (Array.isArray(fonte)) {
      for (const item of fonte) this.adicionarFonte(item, nomeChave);
    } else if (fonte !== null && typeof fonte === "object") {
      for (const [k, v] of Object.entries(fonte)) this.adicionarFonte(v, k);
    }
  }

  contem(n: number): boolean {
    return this.valores.has(chave(n));
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

export function verificarNumeros(mensagem: string, autorizados: NumerosAutorizados): ResultadoVerificacao {
  const encontrados = extrairNumeros(mensagem);
  const naoAutorizados = encontrados.filter((e) => !autorizados.contem(e.valor));
  const porExtenso = encontrarPorExtenso(mensagem);
  return {
    aprovado: naoAutorizados.length === 0 && porExtenso.length === 0,
    encontrados,
    naoAutorizados,
    porExtenso,
  };
}
