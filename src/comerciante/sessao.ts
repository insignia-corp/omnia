import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { DB, type Db } from "../infra/database/database.module";
import { comerciante } from "../infra/database/schema";
import { ehUuid } from "../lib/uuid/uuid";

export const CABECALHO_COMERCIANTE = "x-comerciante-id";

type RequisicaoComSessao = Request & { comercianteId?: string };

/**
 * Sessão do comerciante (regra inviolável 3). Resolve quem está chamando e põe o id no request;
 * a partir daí o `comerciante_id` só chega aos serviços por `@ComercianteDaSessao()`, nunca do corpo
 * da requisição nem do texto de um modelo.
 *
 * Provisório: hoje a identidade vem do cabeçalho `X-Comerciante-Id`, conferido no banco. Quando o
 * canal (chat web ou WhatsApp, #66 e #61) autenticar o dono, só este guard muda.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoComSessao>();
    const id = req.headers[CABECALHO_COMERCIANTE];
    if (typeof id !== "string" || !ehUuid(id)) {
      throw new UnauthorizedException("Comerciante não identificado");
    }
    const [achado] = await this.db
      .select({ id: comerciante.id })
      .from(comerciante)
      .where(eq(comerciante.id, id.toLowerCase()))
      .limit(1);
    if (!achado) throw new UnauthorizedException("Comerciante não identificado");
    req.comercianteId = achado.id;
    return true;
  }
}

/** Id do comerciante da sessão. Só existe em rotas protegidas por `SessaoGuard`. */
export const ComercianteDaSessao = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): string => {
    const id = contexto.switchToHttp().getRequest<RequisicaoComSessao>().comercianteId;
    if (!id) throw new UnauthorizedException("Rota sem sessão de comerciante");
    return id;
  },
);
