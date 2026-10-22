/**
 * Limites de alerta que o dono ajustou (issue #147). A tabela `limite_alerta` é append-only: vale a
 * linha mais recente de cada limite, e o que não tem linha fica no padrão (`LIMITES_PADRAO`). Toda
 * consulta é do comerciante da sessão (regra inviolável 3).
 */
import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "../infra/database/database.module";
import { limiteAlerta, tipoAlerta } from "../infra/database/schema";
import type { FonteDeLimites, LimitesDeAlerta, SobreposicaoDeLimites } from "./limites";
import type { TipoAlerta } from "./tipos";

type LimiteNumerico = Exclude<keyof LimitesDeAlerta, "janelaSupressaoDias">;

interface Faixa {
  min: number;
  max: number;
  inteiro: boolean;
}

/** Faixa aceita de cada limite: o valor fora dela é erro de quem pediu, nunca vira limite do dono. */
const FAIXAS: Readonly<Record<LimiteNumerico, Faixa>> = {
  reajusteLimiteBps: { min: 1, max: 100_000, inteiro: true },
  reajusteJanelaDias: { min: 1, max: 365, inteiro: true },
  giroAltaMinimaBps: { min: 0, max: 100_000, inteiro: true },
  estoqueParadoLimiteDias: { min: 1, max: 3650, inteiro: true },
  ticketQuedaLimiteBps: { min: 1, max: 10_000, inteiro: true },
  gastoLimiteDesvio: { min: 0.1, max: 100, inteiro: false },
  prioridade1MinCentavos: { min: 1, max: Number.MAX_SAFE_INTEGER, inteiro: true },
  prioridade2MinCentavos: { min: 1, max: Number.MAX_SAFE_INTEGER, inteiro: true },
  confiancaMinima: { min: 0, max: 1, inteiro: false },
};

const PREFIXO_SUPRESSAO = "janelaSupressaoDias.";
const FAIXA_SUPRESSAO: Faixa = { min: 0, max: 3650, inteiro: true };

/** Nome de um limite como fica em `limite_alerta.limite`: campo de `LimitesDeAlerta` ou `janelaSupressaoDias.<tipo>`. */
export type NomeDoLimite = LimiteNumerico | `janelaSupressaoDias.${TipoAlerta}`;

export class LimiteInvalidoError extends Error {}

function tipoDaSupressao(nome: string): TipoAlerta | undefined {
  const tipo = nome.startsWith(PREFIXO_SUPRESSAO) ? nome.slice(PREFIXO_SUPRESSAO.length) : "";
  return (tipoAlerta.enumValues as readonly string[]).includes(tipo) ? (tipo as TipoAlerta) : undefined;
}

function faixaDe(nome: string): { faixa: Faixa; aceitaNulo: boolean } | undefined {
  if (Object.hasOwn(FAIXAS, nome)) return { faixa: FAIXAS[nome as LimiteNumerico], aceitaNulo: false };
  if (tipoDaSupressao(nome)) return { faixa: FAIXA_SUPRESSAO, aceitaNulo: true };
  return undefined;
}

/** Confere nome, faixa e tipo do valor antes de gravar; devolve o valor como vai para a coluna. */
export function validarLimite(nome: string, valor: number | null): number | null {
  const regra = faixaDe(nome);
  if (!regra) throw new LimiteInvalidoError(`Limite desconhecido: ${nome}`);
  if (valor === null) {
    if (!regra.aceitaNulo) throw new LimiteInvalidoError(`O limite ${nome} não aceita valor nulo`);
    return null;
  }
  const { min, max, inteiro } = regra.faixa;
  if (!Number.isFinite(valor) || valor < min || valor > max || (inteiro && !Number.isInteger(valor))) {
    throw new LimiteInvalidoError(
      `Valor inválido para ${nome}: ${valor} (de ${min} a ${max}${inteiro ? ", inteiro" : ""})`,
    );
  }
  return valor;
}

/** Monta a sobreposição que o motor mescla com o padrão a partir das linhas vigentes. */
export function sobreposicaoDasLinhas(
  linhas: ReadonlyArray<{ limite: string; valor: string | null }>,
): SobreposicaoDeLimites {
  const numericos: Partial<Record<LimiteNumerico, number>> = {};
  const janelas: Partial<Record<TipoAlerta, number | null>> = {};
  for (const { limite, valor } of linhas) {
    const numero = valor === null ? null : Number(valor);
    const tipo = tipoDaSupressao(limite);
    if (tipo) janelas[tipo] = numero;
    else if (Object.hasOwn(FAIXAS, limite) && numero !== null) numericos[limite as LimiteNumerico] = numero;
  }
  return { ...numericos, janelaSupressaoDias: janelas };
}

export class FonteDeLimitesPostgres implements FonteDeLimites {
  constructor(private readonly db: Executor) {}

  async limitesDoComerciante(comercianteId: string): Promise<SobreposicaoDeLimites> {
    const linhas = await this.db
      .selectDistinctOn([limiteAlerta.limite], { limite: limiteAlerta.limite, valor: limiteAlerta.valor })
      .from(limiteAlerta)
      .where(eq(limiteAlerta.comercianteId, comercianteId))
      .orderBy(limiteAlerta.limite, desc(limiteAlerta.criadoEm), desc(limiteAlerta.id));
    return sobreposicaoDasLinhas(linhas);
  }
}

/**
 * Grava um limite novo do comerciante, depois de o dono confirmar (regra inviolável 7). Insere uma
 * linha e não toca nas anteriores. `comercianteId` vem da sessão, nunca do texto do modelo.
 */
export async function registrarLimite(
  db: Executor,
  comercianteId: string,
  nome: string,
  valor: number | null,
): Promise<void> {
  const validado = validarLimite(nome, valor);
  await db.insert(limiteAlerta).values({
    comercianteId,
    limite: nome,
    valor: validado === null ? null : String(validado),
  });
}

/** O valor vigente de um limite, ou `undefined` quando o dono nunca o ajustou. */
export async function limiteVigente(
  db: Executor,
  comercianteId: string,
  nome: string,
): Promise<{ valor: number | null } | undefined> {
  const [linha] = await db
    .select({ valor: limiteAlerta.valor })
    .from(limiteAlerta)
    .where(and(eq(limiteAlerta.comercianteId, comercianteId), eq(limiteAlerta.limite, nome)))
    .orderBy(desc(limiteAlerta.criadoEm), desc(limiteAlerta.id))
    .limit(1);
  return linha ? { valor: linha.valor === null ? null : Number(linha.valor) } : undefined;
}
