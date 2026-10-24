import path from "node:path";
import { parseArgs } from "node:util";
import { Logger } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lerArquivoEnv } from "../config/arquivo-env";
import { carregarEnv } from "../config/env";
import * as schema from "../infra/database/schema";
import { gravarRodada, resumir } from "./relatorio";
import { ErroAvaliacao, rodarAvaliacao } from "./rodada";
import type { ModoModelo } from "./tipos";

const USO = `Uso: npm run eval -- [--modelo falso|real] [--caso q01,q33] [--prompt v5] [--data AAAA-MM-DD]

  --modelo  falso (padrão): modelo roteirizado, sem rede e sem custo, para a CI
            real: chama a API da Anthropic (exige ANTHROPIC_API_KEY)
  --caso    só estes casos (ids separados por vírgula)
  --prompt  versão do prompt de sistema (padrão v5, o do agente em produção)
  --data    data de hoje dos casos (padrão: o dia seguinte à data de referência do gabarito)

Antes da primeira rodada: npm run seed:demo`;

async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: {
      modelo: { type: "string", default: "falso" },
      caso: { type: "string" },
      prompt: { type: "string" },
      data: { type: "string" },
      ajuda: { type: "boolean", default: false },
    },
  });
  if (values.ajuda) {
    console.log(USO);
    return 0;
  }
  if (values.modelo !== "falso" && values.modelo !== "real") {
    throw new ErroAvaliacao(`--modelo deve ser "falso" ou "real", recebi "${values.modelo}".\n\n${USO}`);
  }
  const modo: ModoModelo = values.modelo;
  lerArquivoEnv();
  const env = carregarEnv();
  if (env.NODE_ENV === "production") throw new ErroAvaliacao("npm run eval não roda em produção.");
  // O modelo falso não tem preço cadastrado e o loop avisa a cada execução; aqui o aviso é ruído.
  if (modo === "falso") Logger.overrideLogger(["error", "fatal"]);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  try {
    const rodada = await rodarAvaliacao({
      db: drizzle(pool, { schema }),
      env,
      modo,
      ...(values.caso ? { casos: values.caso.split(",").map((s) => s.trim()) } : {}),
      ...(values.prompt ? { prompt: values.prompt } : {}),
      ...(values.data ? { dataReferencia: values.data } : {}),
    });
    const arquivos = gravarRodada(rodada, {
      relatorios: path.resolve("docs/avaliacoes"),
      evidencias: path.resolve("evidencias"),
    });
    const resumo = resumir(rodada.resultados);
    for (const r of rodada.resultados) {
      console.log(`${r.aprovado ? "passou " : "FALHOU "} ${r.id} (${r.categoria}) ${r.latenciaMs} ms`);
      for (const m of r.motivos) console.log(`         ${m}`);
    }
    console.log(`\n${resumo.acertos} de ${resumo.total} casos passaram.`);
    console.log(`Relatório: ${path.relative(process.cwd(), arquivos.relatorio)}`);
    console.log(`Saída bruta: ${path.relative(process.cwd(), arquivos.evidencia)}`);
    return resumo.acertos === resumo.total ? 0 : 1;
  } finally {
    await pool.end();
  }
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((e: unknown) => {
    console.error(e instanceof ErroAvaliacao ? e.message : e);
    process.exitCode = 2;
  });
