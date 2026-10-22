/**
 * Parâmetros do modelo `resumo_diario` (issue #182). Fora da janela de 24 h a Meta só aceita modelo,
 * então o relatório diário sai assim, sem passar pelo modelo de linguagem: cada parâmetro vem do
 * resumo diário e do motor de alertas, formatado em código (regra inviolável 1).
 */
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../../metricas/resultado-metrica";
import type { ResumoDiario } from "../../metricas/resumo-diario";
import { montarTemplate } from "./modelos";
import type { Template } from "./formato";

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** No máximo 3 avisos por relatório, como o `select_alerts` do agente. */
export const MAX_AVISOS = 3;

/** "segunda, 19/10" a partir de uma data ISO, sem fuso: a data já é a local. */
export function rotuloDoDia(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number) as [number, number, number];
  const semana = DIAS_DA_SEMANA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()]!;
  return `${semana}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** Pontos-base para "30,23%" (ou "25%" sem centésimos), só com inteiros. */
export function formatarBps(bps: number): string {
  const s = String(Math.abs(bps)).padStart(3, "0");
  const centesimos = s.slice(-2);
  return `${bps < 0 ? "-" : ""}${s.slice(0, -2)}${centesimos === "00" ? "" : `,${centesimos}`}%`;
}

/**
 * O template preenchido, ou nulo quando falta dado para algum parâmetro (dia sem vendas ou sem a
 * média dos 7 dias anteriores): modelo com parâmetro inventado nunca sai.
 */
export function modeloResumoDiario(
  resumo: ResultadoMetrica<ResumoDiario> | DadoAusente,
  nomeComercio: string,
  avisos: number,
): Template | null {
  if (ehDadoAusente(resumo)) return null;
  const r = resumo.valor;
  const media = r.comparacao_faturamento.media_7_dias_anteriores;
  if (ehDadoAusente(media) || media.variacao_bps === null) return null;
  const sentido = media.variacao_bps < 0 ? "abaixo" : "acima";
  return montarTemplate(
    "resumo_diario",
    [
      rotuloDoDia(r.data),
      nomeComercio,
      formatarBRL(centavos(r.faturamento_centavos)),
      String(r.cupons),
      `${formatarBps(Math.abs(media.variacao_bps))} ${sentido}`,
      String(Math.min(avisos, MAX_AVISOS)),
    ],
    ["avisos", "resumo_dia", "cancelar"],
  );
}
