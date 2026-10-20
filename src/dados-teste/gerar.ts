import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gerarExtrato } from "./extrato";
import { gerarGabaritoMetricas } from "./gabarito-metricas";
import { catalogo, DATA_REFERENCIA, fornecedores, perfil } from "./mercadinho";
import { definicoesNotas, gabaritoDaNota, xmlNfe } from "./notas";
import { gerarPerguntas } from "./perguntas";
import { gerarVendas, vendasParaCsv } from "./vendas";

const json = (valor: unknown): string => `${JSON.stringify(valor, null, 2)}\n`;

/** Todos os arquivos de fixture, por caminho relativo a `fixtures/`. Determinístico. */
export function gerarArquivos(): Map<string, string> {
  const vendas = gerarVendas();
  const extrato = gerarExtrato(vendas);
  const gabarito = gerarGabaritoMetricas(vendas, extrato);
  const arquivos = new Map<string, string>();

  arquivos.set("mercadinho/perfil.json", json({ ...perfil, data_referencia: DATA_REFERENCIA }));
  arquivos.set("mercadinho/fornecedores.json", json(fornecedores));
  arquivos.set("mercadinho/catalogo.json", json(catalogo));
  arquivos.set("vendas/vendas.csv", vendasParaCsv(vendas));

  for (const n of definicoesNotas) {
    arquivos.set(`notas/${n.id}.esperado.json`, json(gabaritoDaNota(n)));
    if (n.formato === "xml") arquivos.set(`notas/${n.id}.xml`, xmlNfe(n));
  }

  arquivos.set(
    "banco/conta.json",
    json({ id: "conta-demo-1", instituicao: "Banco Sandbox", tipo: "corrente", moeda: "BRL" }),
  );
  arquivos.set("banco/transacoes.json", json(extrato));
  arquivos.set("gabarito/metricas.json", json(gabarito));
  arquivos.set("avaliacao/perguntas.json", json(gerarPerguntas(vendas, extrato, gabarito)));
  return arquivos;
}

function main(): void {
  const raiz = join(process.cwd(), "fixtures");
  for (const [caminho, conteudo] of gerarArquivos()) {
    const destino = join(raiz, caminho);
    mkdirSync(join(destino, ".."), { recursive: true });
    writeFileSync(destino, conteudo);
  }
  console.log(`Fixtures gravadas em ${raiz}`);
}

if (require.main === module) main();
