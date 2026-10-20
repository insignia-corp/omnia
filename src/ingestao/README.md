# ingestao

Foto de nota (modelo com visão + validação em código), planilha de vendas e NF-e. Issues: #22 a #29. Estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Caminho de uma foto

`POST /documentos/notas` (campo `arquivo`, cabeçalho `X-Comerciante-Id`) guarda o arquivo (`src/infra/armazenamento`), cria o `documento` como `pendente` e enfileira o job `extrair-nota` no BullMQ (3 tentativas, espera exponencial). O worker (`fila/fila-extracao.ts`) chama `ProcessadorExtracao`, que:

1. lê a imagem e chama o `ExtratorNotas` (`extracao/`), módulo isolado atrás da porta `ClienteVisao`;
2. confere a nota em código (`validacao/validar-nota.ts`): somas, quantidade x unitário, CNPJ e data. Divergência reduz a confiança e deixa o motivo, não descarta;
3. grava fornecedor, compra e itens numa transação (`gravar-compra.ts`) e deixa o documento em `extraido` ou `revisao`;
4. registra a execução (gatilho `extracao_nota`) com tokens, custo e latência.

`GET /documentos/:id` devolve status, motivos, compra e itens com a confiança de cada um.

## Vínculo com o produto (#27)

Depois de gravar os itens, cada descrição tenta ligar a um produto (`vinculo/vincular-produto.ts`), nesta ordem:

1. vínculo já confirmado pelo dono (mesmo fornecedor primeiro, depois qualquer um): liga sem perguntar;
2. similaridade `pg_trgm` contra o catálogo e contra descrições já confirmadas. Liga sozinho se passar de `LIMITE_SIMILARIDADE` e superar o segundo candidato por 0,1; senão pergunta ao dono com até 3 sugestões.

Item ligado grava uma linha em `historico_custo` com a menor entre a confiança do item e a do vínculo. Item sem produto fica sem custo no histórico até o dono escolher. O código de barras entra com a NF-e (#29). A sugestão pelo modelo, quando as duas buscas falham, está pendente (#27).

Medido com as 18 notas de `fixtures/` e o catálogo de 50 produtos (`tests/vinculo-notas.e2e-spec.ts`): 94 itens, 97,9% ligam sozinhos ao produto certo, nenhum liga ao errado, e os 2 restantes vão ao dono com o produto certo entre as sugestões.

## Perguntas ao dono (#26)

Item abaixo de `LIMITE_CONFIANCA_ITEM` gera uma `pergunta_dono` `confirmar_item`; item sem produto gera `confirmar_vinculo`. O texto é montado pelo código (`revisao/perguntas.ts`), sem modelo.

- `GET /perguntas` lista as pendentes.
- `POST /perguntas/:id/resposta` com `{ "valor_unitario_centavos": 330, "quantidade": 24 }` (item) ou `{ "produto_id": "..." }` (vínculo). A interpretação de texto livre do dono é do agente (#53).

A correção do item entra com origem `dono` e confiança 1, e o `historico_custo` ganha uma linha nova: o que o modelo leu continua lá. O documento é recalculado (`revisao/recalcular-documento.ts`): soma refeita contra o total, motivo do item resolvido sai, status volta a `extraido` quando não resta item duvidoso nem motivo do documento. Confirmar um vínculo liga também os outros itens iguais do mesmo fornecedor e dispensa as perguntas deles.

## Planilha de vendas (#28)

`POST /documentos/planilhas` (campo `arquivo`, CSV ou XLSX) guarda o arquivo, cria o `documento` e lê os cabeçalhos. O formato é identificado pela assinatura dos cabeçalhos (`planilha/mapeamento.ts`):

- **Primeira vez do formato:** devolve `precisa_confirmar` com o mapeamento sugerido (data, hora, cupom, código de barras, produto, quantidade, preço unitário, total) e os campos obrigatórios que faltam. O dono confirma em `POST /documentos/planilhas/:id/confirmar` com `{ "mapeamento": { "data": "Data", ... } }`; o mapeamento fica em `mapeamento_planilha` por comerciante.
- **Formato já confirmado:** importa na hora, sem perguntar de novo.

Cada linha vira item de venda (`planilha/interpretar-linhas.ts`): data `dd/mm/aaaa` ou ISO, preço em centavos com `parseCentavos`, produto pelo código de barras e, sem ele, pelo nome normalizado do cadastro. O total da planilha, quando há, é conferido contra quantidade x preço. Linha que não dá para interpretar vai para o relatório (`linhas_rejeitadas`, com número e motivo) e as demais seguem; com rejeição o documento fica em `revisao`. Produto fora do cadastro é rejeitado, não criado.

A venda é única por `(comerciante, data, cupom)`: reimportar o mesmo arquivo, ou outro que repita cupons, não duplica. Sem coluna de cupom, cada linha vira uma venda de um item. A importação é síncrona na requisição (a planilha da demo, com 11.365 linhas, leva cerca de 2 s).

Conferido contra o gabarito (`tests/planilha-vendas.e2e-spec.ts`): CSV e XLSX importam 3.623 cupons e 11.365 itens sem rejeição; em 2026-10-19 são 78 cupons e R$ 1.221,51.

## Falhas

| Caso | Resultado |
| --- | --- |
| JSON fora do esquema | uma nova tentativa com o erro do Zod; depois `falha` (`json_invalido`) |
| Imagem ilegível, recusa, erro não transitório | `falha` na hora, nada gravado |
| Timeout, 429, 5xx | o BullMQ repete o job; `falha` só na última tentativa |
| Job repetido de documento já resolvido | ignorado, sem nova chamada ao modelo |

## Pendente nesta etapa

Sugestão de vínculo pelo modelo (#27) e NF-e em XML (#29). O aviso ao dono quando a extração falha depende do canal (#106, #66): hoje o estado fica em `documento.status` e `documento.erro`.
