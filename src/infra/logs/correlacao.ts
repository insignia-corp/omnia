import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { PinoLogger } from "nestjs-pino";

/** Campo do log que liga a requisição HTTP aos jobs que ela enfileirou (issue #10). */
export const CAMPO_CORRELACAO = "idCorrelacao";
/** `X-Request-Id` do cliente só é aceito curto e sem espaço ou quebra de linha. */
const ID_ACEITO = /^[A-Za-z0-9._-]{1,64}$/;

/** Id da requisição (`genReqId` do pino-http): o `X-Request-Id` válido do cliente ou um novo. */
export function idDaRequisicao(req: Pick<IncomingMessage, "headers">): string {
  const enviado = req.headers["x-request-id"];
  return typeof enviado === "string" && ID_ACEITO.test(enviado) ? enviado : randomUUID();
}

/** Id de correlação do contexto de log atual (requisição ou job); fora deles, um novo. */
export function idCorrelacaoAtual(pino: Pick<PinoLogger, "logger">): string {
  const atual: unknown = pino.logger.bindings()[CAMPO_CORRELACAO];
  return typeof atual === "string" ? atual : randomUUID();
}

/** Roda o job num contexto de log com o id de quem o enfileirou: todo log dentro dele leva o mesmo id. */
export function comCorrelacao<T>(
  pino: Pick<PinoLogger, "runInContext">,
  id: string | undefined,
  extras: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return pino.runInContext(fn, { bindings: { [CAMPO_CORRELACAO]: id ?? randomUUID(), ...extras } });
}
