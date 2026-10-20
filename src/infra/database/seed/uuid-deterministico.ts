import { createHash } from "node:crypto";

/** Namespace fixo do Omnia: o seed gera sempre os mesmos ids para os mesmos nomes. */
const NAMESPACE = "6f6d6e69-612d-5365-6564-2d6e73303030";

/** UUID versão 5 (SHA-1 de namespace + nome), sem dependências. */
export function uuidDeterministico(nome: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex"))
    .update(nome)
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
