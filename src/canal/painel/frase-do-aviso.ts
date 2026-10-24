/**
 * Frase curta de cada aviso do painel (issue #207), em linguagem simples. Montada em código por tipo
 * de alerta, só com os campos de `metricasApoio` que a regra gravou (ver `src/alertas/regras.ts`):
 * todo número da frase sai de lá, formatado de centavos e pontos-base (regras invioláveis 1 e 2). Se
 * faltar um campo, a frase volta a ser o rótulo do alerta com o produto, sem número nenhum.
 *
 * A frase vai em trechos para a página destacar nomes e números sem montar HTML: cada trecho é
 * escrito com `textContent`, porque o nome do produto e do fornecedor vem de nota.
 */
import type { TipoAlerta } from "../../alertas/tipos";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { formatarBps } from "../whatsapp/modelo-resumo-diario";

export interface TrechoDaFrase {
  texto: string;
  destaque?: true;
}

export interface EntradaFraseDoAviso {
  tipo: TipoAlerta;
  rotulo: string;
  /** Nome do produto no cadastro; cai no `produto_nome` da métrica quando não houver. */
  produto: string | null;
  fornecedor: string | null;
  metricasApoio: Record<string, unknown>;
}

const t = (texto: string): TrechoDaFrase => ({ texto });
const forte = (texto: string): TrechoDaFrase => ({ texto, destaque: true });

const inteiro = (m: Record<string, unknown>, campo: string): number | null => {
  const v = m[campo];
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
};
const dataIso = (m: Record<string, unknown>, campo: string): string | null => {
  const v = m[campo];
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const reais = (c: number): string => formatarBRL(centavos(c));
const diaMes = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const algumNulo = (...v: unknown[]): boolean => v.some((x) => x === null);

/** A frase por tipo, ou nula quando falta algum campo de que ela precisa. */
function fraseDoTipo(e: EntradaFraseDoAviso, produto: string | null): TrechoDaFrase[] | null {
  const m = e.metricasApoio;
  switch (e.tipo) {
    case "margem_abaixo_da_meta": {
      const margem = inteiro(m, "margem_bps");
      const meta = inteiro(m, "meta_bps");
      if (algumNulo(produto, margem, meta)) return null;
      return [
        forte(produto!),
        t(" está vendendo com margem de "),
        forte(formatarBps(margem!)),
        t(`. Sua meta é ${formatarBps(meta!)}.`),
      ];
    }
    case "reajuste_de_custo": {
      const variacao = inteiro(m, "variacao_bps");
      const antes = inteiro(m, "custo_anterior_centavos");
      const agora = inteiro(m, "custo_atual_centavos");
      if (algumNulo(produto, variacao, antes, agora)) return null;
      const quem = e.fornecedor ? [forte(e.fornecedor), t(" subiu o preço de ")] : [t("O custo de ")];
      return [
        ...quem,
        forte(produto!),
        t(e.fornecedor ? " em " : " subiu "),
        forte(formatarBps(variacao!)),
        t(`, de ${reais(antes!)} para ${reais(agora!)}.`),
      ];
    }
    case "giro_em_alta": {
      const alta = inteiro(m, "alta_bps");
      const unidades = inteiro(m, "unidades_7_dias");
      if (algumNulo(produto, alta, unidades)) return null;
      return [
        forte(produto!),
        t(" está vendendo mais que o normal: "),
        forte(`${unidades!} unidades`),
        t(` em 7 dias, ${formatarBps(alta!)} acima da média. Vale reforçar o estoque.`),
      ];
    }
    case "espaco_para_subir_preco": {
      const margem = inteiro(m, "margem_bps");
      const meta = inteiro(m, "meta_bps");
      if (algumNulo(produto, margem, meta)) return null;
      return [
        forte(produto!),
        t(" vende bem e está com margem de "),
        forte(formatarBps(margem!)),
        t(`, abaixo da meta de ${formatarBps(meta!)}. Dá para subir o preço.`),
      ];
    }
    case "estoque_parado": {
      const dias = inteiro(m, "dias_sem_venda");
      if (algumNulo(produto, dias)) return null;
      return [forte(produto!), t(" está sem venda há "), forte(`${dias!} dias`), t(".")];
    }
    case "ticket_medio_em_queda": {
      const data = dataIso(m, "data");
      const ticket = inteiro(m, "ticket_medio_centavos");
      const media = inteiro(m, "media_28_dias_centavos");
      const queda = inteiro(m, "queda_bps");
      if (algumNulo(data, ticket, media, queda)) return null;
      return [
        t(`O ticket médio de ${diaMes(data!)} foi `),
        forte(reais(ticket!)),
        t(", "),
        forte(formatarBps(queda!)),
        t(` abaixo da média de 28 dias (${reais(media!)}).`),
      ];
    }
    case "gasto_fora_do_padrao": {
      const data = dataIso(m, "data");
      const valor = inteiro(m, "valor_centavos");
      const mediana = inteiro(m, "mediana_centavos");
      if (algumNulo(data, valor, mediana)) return null;
      return [
        t(`Os gastos de ${diaMes(data!)} somaram `),
        forte(reais(valor!)),
        t(`, bem acima do normal (mediana de ${reais(mediana!)}).`),
      ];
    }
  }
}

export function fraseDoAviso(e: EntradaFraseDoAviso): TrechoDaFrase[] {
  const nomeDaMetrica = e.metricasApoio.produto_nome;
  const produto = e.produto ?? (typeof nomeDaMetrica === "string" && nomeDaMetrica ? nomeDaMetrica : null);
  return (
    fraseDoTipo(e, produto) ?? [t(produto ? `${e.rotulo}: ` : e.rotulo), ...(produto ? [forte(produto)] : [])]
  );
}
