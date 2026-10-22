import { Controller, Get, Inject, NotFoundException, Param, Query, Req, Res } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DB, type Db } from "../../infra/database/database.module";
import { comerciante } from "../../infra/database/schema";
import { uuidDeterministico } from "../../infra/database/seed/uuid-deterministico";
import { ehUuid } from "../../lib/uuid/uuid";

/** Comerciante do seed da demo (`npm run seed:demo`, chave `vila-nova`): o id é sempre o mesmo. */
export const COMERCIANTE_DEMO = uuidDeterministico("vila-nova/comerciante/");

const TIPOS: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
};
/** Só arquivos da raiz da pasta, sem subpasta (os testes ficam de fora) e sem `..`. */
const NOME_ARQUIVO = /^[a-z0-9-]+\.(js|css|html)$/;

/**
 * Onde está `web/whatsapp`: ao lado de `src` em desenvolvimento e nos testes, ao lado de `dist` no
 * build e na imagem Docker (o Dockerfile copia a pasta para `/app/web/whatsapp`).
 */
export function pastaWhatsapp(): string | null {
  const candidatos = [resolve(__dirname, "../../../web/whatsapp"), resolve(process.cwd(), "web/whatsapp")];
  return candidatos.find((c) => existsSync(join(c, "index.html"))) ?? null;
}

/**
 * Serve o front do WhatsApp simulado (issue #182) na mesma origem da API, sem build: os módulos ES
 * da pasta vão como estão. Sem guard: a identidade é conferida nas rotas `/chat/*` que ele chama.
 */
@Controller("whatsapp")
export class WhatsappController {
  private readonly pasta = pastaWhatsapp();

  constructor(@Inject(DB) private readonly db: Db) {}

  /** A página. Sem a barra final, os `./app.js` da página apontariam para a raiz do site. */
  @Get()
  pagina(@Req() req: Request, @Res() res: Response): void {
    if (!req.path.endsWith("/")) {
      const consulta = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      res.redirect(302, `/whatsapp/${consulta}`);
      return;
    }
    this.enviarArquivo("index.html", res);
  }

  /**
   * Quem é o dono nesta tela: o `?comerciante=` informado ou, sem ele, o comerciante do seed da demo.
   * Provisório como o `X-Comerciante-Id` (ver `src/comerciante/sessao.ts`).
   */
  @Get("sessao")
  async sessao(@Query("comerciante") informado?: string) {
    const id = informado ?? COMERCIANTE_DEMO;
    const [achado] = ehUuid(id)
      ? await this.db
          .select({ id: comerciante.id, nome: comerciante.nome })
          .from(comerciante)
          .where(eq(comerciante.id, id.toLowerCase()))
          .limit(1)
      : [];
    if (!achado) {
      throw new NotFoundException(
        informado
          ? "Comerciante não encontrado"
          : "Sem o comerciante da demo: rode `npm run seed:demo` ou abra com ?comerciante=<id>",
      );
    }
    return { comerciante_id: achado.id, nome: achado.nome };
  }

  @Get(":arquivo")
  arquivo(@Param("arquivo") nome: string, @Res() res: Response): void {
    this.enviarArquivo(nome, res);
  }

  private enviarArquivo(nome: string, res: Response): void {
    const extensao = NOME_ARQUIVO.exec(nome)?.[1];
    const caminho = this.pasta && extensao ? join(this.pasta, nome) : null;
    if (!caminho || !extensao || !existsSync(caminho)) throw new NotFoundException("Arquivo não encontrado");
    res.setHeader("Content-Type", TIPOS[extensao]!);
    // Sem build nem hash no nome: o navegador revalida a cada carga para pegar a versão nova.
    res.setHeader("Cache-Control", "no-cache");
    res.send(readFileSync(caminho));
  }
}
