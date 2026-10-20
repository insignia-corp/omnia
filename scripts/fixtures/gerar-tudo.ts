/**
 * Gera todos os dados de teste em `fixtures/` com semente fixa (issues #12 a #16 e #18).
 * Uso: `npm run fixtures:gerar`. Duas execuções seguidas produzem arquivos idênticos.
 *
 * As imagens das notas usam ImageMagick (`magick`). Sem ele, passe `--sem-imagens` e os
 * PNGs já versionados permanecem como estão.
 */
import { escreverExtrato, montarExtrato } from "./extrato";
import { gerarGabarito } from "./gabarito";
import { escreverMercadinho, montarMercadinho } from "./mercadinho";
import { escreverNotas, montarNotas } from "./notas";
import { escreverVendasCsv, escreverVendasXlsx, montarVendas } from "./vendas";

async function main(): Promise<void> {
  const comImagens = !process.argv.includes("--sem-imagens");
  const mercadinho = montarMercadinho();
  escreverMercadinho(mercadinho);

  const cupons = montarVendas(mercadinho.catalogo);
  escreverVendasCsv(cupons, mercadinho.catalogo);
  await escreverVendasXlsx(cupons, mercadinho.catalogo);

  const notas = montarNotas(mercadinho.fornecedores);
  escreverNotas(notas, comImagens);
  escreverExtrato(montarExtrato(cupons, notas));

  gerarGabarito();
  console.log(
    `fixtures: ${mercadinho.catalogo.length} produtos, ${cupons.length} cupons, ${notas.length} notas${comImagens ? " com imagens" : ""}`,
  );
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
