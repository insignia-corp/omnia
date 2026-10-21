import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

type Json = null | boolean | number | string | Json[] | { [chave: string]: Json };

const PREFIXO_REF = "#/$defs/";

function inlinar(no: Json, defs: Record<string, Json>): Json {
  if (Array.isArray(no)) return no.map((n) => inlinar(n, defs));
  if (no === null || typeof no !== "object") return no;
  const { $ref, ...resto } = no;
  const restoInline = Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, inlinar(v, defs)]));
  if (typeof $ref !== "string") return restoInline;
  const nome = $ref.startsWith(PREFIXO_REF) ? $ref.slice(PREFIXO_REF.length) : undefined;
  const alvo = nome === undefined ? undefined : defs[nome];
  if (alvo === undefined) throw new Error(`Referência de esquema sem definição: ${$ref}`);
  const resolvido = inlinar(alvo, defs);
  return typeof resolvido === "object" && resolvido !== null && !Array.isArray(resolvido)
    ? { ...resolvido, ...restoInline }
    : resolvido;
}

/**
 * JSON Schema da saída estruturada, sem `$defs` nem `$ref`. O Zod move para `$defs` todo objeto repetido
 * ou aninhado em lista, e a API da Anthropic recusa `$defs` junto de `anyOf` (400 "For 'anyOf', '$defs'
 * is not supported"), que é o caso da resposta do Extrator: nota ou aviso de imagem ilegível.
 * Os esquemas daqui não são recursivos, então inlinar basta.
 */
export function esquemaSaidaJson(esquema: z.ZodType): {
  type: "json_schema";
  schema: Record<string, unknown>;
} {
  const { schema } = zodOutputFormat(esquema) as unknown as { schema: { [chave: string]: Json } };
  const { $defs, ...semDefs } = schema;
  const defs = ($defs ?? {}) as Record<string, Json>;
  return { type: "json_schema", schema: inlinar(semDefs, defs) as Record<string, unknown> };
}
