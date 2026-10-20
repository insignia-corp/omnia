import { centavos, ErroDinheiro, multiplicar, parseCentavos } from "../../lib/dinheiro/dinheiro";
import { normalizarDescricao } from "../normalizar-descricao";
import type { Campo, Mapeamento } from "./mapeamento";

/** Produtos do comerciante que a importação enxerga, indexados para busca exata. */
export interface CatalogoProdutos {
  /** Só dígitos do código de barras -> id do produto. */
  porCodigoBarras: ReadonlyMap<string, string>;
  /** Nome normalizado (`normalizarDescricao`) -> id do produto, só para nomes que não se repetem. */
  porNome: ReadonlyMap<string, string>;
  /** Nomes normalizados que dois ou mais produtos têm: sem código de barras, a linha é rejeitada. */
  nomesAmbiguos: ReadonlySet<string>;
}

/** Indexa o cadastro do comerciante para a importação. Nome repetido nunca escolhe um produto. */
export function montarCatalogo(
  produtos: ReadonlyArray<{ id: string; nome: string; codigoBarras: string | null }>,
): CatalogoProdutos {
  const porCodigoBarras = new Map<string, string>();
  const porNome = new Map<string, string>();
  const nomesAmbiguos = new Set<string>();
  for (const p of produtos) {
    const codigo = p.codigoBarras?.replace(/\D/g, "");
    if (codigo) porCodigoBarras.set(codigo, p.id);
    const nome = normalizarDescricao(p.nome);
    if (nomesAmbiguos.has(nome)) continue;
    if (porNome.has(nome)) {
      porNome.delete(nome);
      nomesAmbiguos.add(nome);
    } else {
      porNome.set(nome, p.id);
    }
  }
  return { porCodigoBarras, porNome, nomesAmbiguos };
}

export interface ItemInterpretado {
  /** Linha na planilha (o cabeçalho é a 1), sem contar linhas em branco. */
  linha: number;
  /** AAAA-MM-DD. */
  data: string;
  hora: string | null;
  cupom: string;
  produtoId: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  totalCentavos: number;
}

export interface LinhaRejeitada {
  linha: number;
  motivo: string;
}

export interface EntradaInterpretacao {
  cabecalhos: readonly string[];
  linhas: readonly string[][];
  mapeamento: Mapeamento;
  /**
   * Identifica a planilha de origem. Sem coluna de cupom, o cupom sintético leva este prefixo, para
   * duas planilhas diferentes no mesmo dia não gerarem os mesmos cupons (`L2`, `L3`...) e uma
   * descartar as vendas da outra. O mesmo arquivo gera sempre os mesmos cupons.
   */
  origem?: string;
}

/** Diferença de arredondamento aceita entre o total da planilha e quantidade x preço. */
export const TOLERANCIA_TOTAL_CENTAVOS = 1;

/** AAAA-MM-DD a partir de "20/08/2026", "20-08-2026" ou "2026-08-20"; null se não for data real. */
export function interpretarData(texto: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texto);
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/.exec(texto);
  const [ano, mes, dia] = iso ? [iso[1]!, iso[2]!, iso[3]!] : br ? [br[3]!, br[2]!, br[1]!] : [];
  if (!ano || !mes || !dia) return null;
  const candidato = `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  const t = Date.parse(`${candidato}T00:00:00Z`);
  // Date.parse rola "2026-02-31" para março; só vale a data que volta igual.
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== candidato ? null : candidato;
}

function interpretarHora(texto: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return h < 24 && min < 60 && s < 60
    ? `${String(h).padStart(2, "0")}:${m[2]}:${String(s).padStart(2, "0")}`
    : null;
}

/** `item_de_venda.quantidade` é numeric(14,3): até 3 casas decimais e 11 dígitos inteiros. */
const QUANTIDADE_MAXIMA = 1e11;

/**
 * Quantidade com vírgula ou ponto decimal ("1,5", "0.250"). Mais casas que o banco guarda é
 * rejeitado, em vez de arredondar na gravação e deixar quantidade, preço e total divergentes. Não
 * usa parseFloat (regra do lint).
 */
function interpretarQuantidade(texto: string): number | null {
  if (!/^\d+([.,]\d{1,3})?$/.test(texto.trim())) return null;
  const n = Number(texto.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < QUANTIDADE_MAXIMA ? n : null;
}

/**
 * Transforma as linhas da planilha em itens de venda, pelo mapeamento confirmado (issue #28). Linha
 * que não dá para interpretar vai para `rejeitadas` com o motivo, e as demais seguem: uma linha
 * ruim não derruba a importação. Dinheiro sempre em centavos (regra inviolável 2); o total da
 * planilha, quando existe, é conferido contra quantidade x preço (regra 5, em código).
 */
export function interpretarLinhas(
  { cabecalhos, linhas, mapeamento, origem }: EntradaInterpretacao,
  catalogo: CatalogoProdutos,
): { itens: ItemInterpretado[]; rejeitadas: LinhaRejeitada[] } {
  const indice = (campo: Campo): number => {
    const coluna = mapeamento[campo];
    return coluna ? cabecalhos.indexOf(coluna) : -1;
  };
  const col = {
    data: indice("data"),
    hora: indice("hora"),
    cupom: indice("cupom"),
    codigo: indice("codigo_barras"),
    produto: indice("produto"),
    quantidade: indice("quantidade"),
    preco: indice("preco_unitario"),
    total: indice("total"),
  };
  const celula = (linha: string[], i: number): string => (i >= 0 ? (linha[i] ?? "").trim() : "");

  const itens: ItemInterpretado[] = [];
  const rejeitadas: LinhaRejeitada[] = [];
  linhas.forEach((linha, posicao) => {
    const numero = posicao + 2;
    const rejeitar = (motivo: string) => rejeitadas.push({ linha: numero, motivo });

    const data = interpretarData(celula(linha, col.data));
    if (!data) return rejeitar(`Data inválida: "${celula(linha, col.data)}"`);

    const quantidade = interpretarQuantidade(celula(linha, col.quantidade));
    if (quantidade === null) return rejeitar(`Quantidade inválida: "${celula(linha, col.quantidade)}"`);

    let preco;
    try {
      preco = parseCentavos(celula(linha, col.preco));
    } catch (e) {
      return rejeitar(
        e instanceof ErroDinheiro ? `Preço inválido: "${celula(linha, col.preco)}"` : String(e),
      );
    }
    if (preco < 0) return rejeitar(`Preço negativo: "${celula(linha, col.preco)}"`);

    const codigo = celula(linha, col.codigo).replace(/\D/g, "");
    const nome = normalizarDescricao(celula(linha, col.produto));
    const porCodigo = codigo ? catalogo.porCodigoBarras.get(codigo) : undefined;
    if (!porCodigo && catalogo.nomesAmbiguos.has(nome)) {
      return rejeitar(
        `Mais de um produto com o nome "${celula(linha, col.produto)}": informe o código de barras`,
      );
    }
    const produtoId = porCodigo ?? catalogo.porNome.get(nome);
    if (!produtoId) {
      return rejeitar(
        `Produto não encontrado no cadastro: "${celula(linha, col.produto)}"${codigo ? ` (código ${codigo})` : ""}`,
      );
    }

    const total = multiplicar(centavos(preco), quantidade);
    const textoTotal = celula(linha, col.total);
    if (textoTotal) {
      let informado;
      try {
        informado = parseCentavos(textoTotal);
      } catch {
        return rejeitar(`Total inválido: "${textoTotal}"`);
      }
      if (Math.abs(informado - total) > TOLERANCIA_TOTAL_CENTAVOS) {
        return rejeitar(
          `Total não confere: a planilha traz ${informado} centavos e quantidade x preço dá ${total}`,
        );
      }
    }

    itens.push({
      linha: numero,
      data,
      hora: interpretarHora(celula(linha, col.hora)),
      // Sem coluna de cupom, cada linha é uma venda de um item só, identificada pela planilha.
      cupom: celula(linha, col.cupom) || `${origem ? `${origem}-` : ""}L${numero}`,
      produtoId,
      quantidade,
      precoUnitarioCentavos: preco,
      totalCentavos: total,
    });
  });
  return { itens, rejeitadas };
}
