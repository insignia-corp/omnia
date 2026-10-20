# ingestao

Foto de nota (modelo com visão + validação em código), planilha de vendas e NF-e. Issues: #22 a #29. Estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Caminho de uma foto

`POST /documentos/notas` (campo `arquivo`, cabeçalho `X-Comerciante-Id`) guarda o arquivo (`src/infra/armazenamento`), cria o `documento` como `pendente` e enfileira o job `extrair-nota` no BullMQ (3 tentativas, espera exponencial). O worker (`fila/fila-extracao.ts`) chama `ProcessadorExtracao`, que:

1. lê a imagem e chama o `ExtratorNotas` (`extracao/`), módulo isolado atrás da porta `ClienteVisao`;
2. confere a nota em código (`validacao/validar-nota.ts`): somas, quantidade x unitário, CNPJ e data. A quantidade já é arredondada às 3 casas do banco antes da conferência. Divergência reduz a confiança e deixa o motivo, não descarta;
3. registra a execução (gatilho `extracao_nota`) com tokens, custo e latência, antes de gravar: a chamada já foi cobrada, então uma queda ou um job repetido não deixam extração sem auditoria;
4. grava fornecedor, compra e itens numa transação (`gravar-compra.ts`) e deixa o documento em `extraido` ou `revisao`. Há `revisao` quando existe item duvidoso ou a confiança do documento fica abaixo do limite; nesse caso a nota nunca fica sem saída, porque ela gera a pergunta do item ou a do documento (veja "Perguntas ao dono").

Dois casos de entrada ruim não derrubam a gravação: CNPJ sem 14 dígitos (ilegível, "N/A") grava o fornecedor com `cnpj` nulo e o reaproveita só pelo nome entre fornecedores também sem CNPJ, nunca com identificador vazio compartilhado; data que não existe no calendário ("2026-02-31") grava a compra na data do envio do documento, com o motivo `data_invalida`, a confiança do documento reduzida e a do histórico de custo limitada a ela. Se a gravação falhar na última tentativa, o documento vai para `falha` em vez de ficar em `processando`.

`GET /documentos/:id` devolve status, motivos, compra e itens com a confiança de cada um.

## Vínculo com o produto (#27)

Depois de gravar os itens, cada descrição tenta ligar a um produto (`vinculo/vincular-produto.ts`), nesta ordem:

1. vínculo já confirmado pelo dono (mesmo fornecedor primeiro, depois qualquer um): liga sem perguntar;
2. similaridade `pg_trgm` contra o catálogo e contra descrições já confirmadas. Liga sozinho se passar de `LIMITE_SIMILARIDADE` e superar o segundo candidato por 0,1; senão pergunta ao dono com até 3 sugestões.

Item ligado grava uma linha em `historico_custo` com a menor entre a confiança do item, a do vínculo e a do documento (CNPJ, data e soma conferidos em código). Item sem produto fica sem custo no histórico até o dono escolher. O `cEAN` da NF-e é lido, mas o vínculo por código de barras ainda não o usa (#27). A sugestão pelo modelo, quando as duas buscas falham, está pendente (#27).

Medido com as 18 notas de `fixtures/` e o catálogo de 50 produtos (`tests/vinculo-notas.e2e-spec.ts`): 94 itens, 97,9% ligam sozinhos ao produto certo, nenhum liga ao errado, e os 2 restantes vão ao dono com o produto certo entre as sugestões.

## Perguntas ao dono (#26)

Item abaixo de `LIMITE_CONFIANCA_ITEM` gera uma `pergunta_dono` `confirmar_item`; item sem produto gera `confirmar_vinculo`; dúvida da nota inteira (motivo de CNPJ, data ou soma, ou leitura geral ruim sem item duvidoso) gera `confirmar_documento`. O texto é montado pelo código (`revisao/perguntas.ts`), sem modelo.

- `GET /perguntas` lista as pendentes.
- `POST /perguntas/:id/resposta` com `{ "valor_unitario_centavos": 330, "quantidade": 24 }` (item) `{ "produto_id": "..." }` (vínculo) ou `{ "confirmado": true }` (documento). A interpretação de texto livre do dono é do agente (#53).

A correção do item entra com origem `dono` e confiança 1 (a quantidade, se vier, com no máximo 3 casas decimais, a precisão de `item_de_compra.quantidade`), e o `historico_custo` ganha uma linha nova: o que o modelo leu continua lá. O documento é recalculado (`revisao/recalcular-documento.ts`): soma refeita contra o total, motivo do item resolvido sai, status volta a `extraido` quando não resta item duvidoso nem motivo do documento. Confirmar um vínculo liga também os outros itens iguais do mesmo fornecedor e dispensa as perguntas deles.

Confirmar o documento tira a nota da revisão (motivo `documento_confirmado`: os motivos continuam na lista, mas deixam de reduzir a confiança) e reemite o custo dos itens ligados com a confiança nova, em linhas novas do `historico_custo`. Corrigir um item que faça a soma deixar de fechar também cria essa pergunta, para a nota nunca ficar em revisão sem saída.

## Planilha de vendas (#28)

`POST /documentos/planilhas` (campo `arquivo`, CSV ou XLSX) guarda o arquivo, cria o `documento` e lê os cabeçalhos. O formato é identificado pela assinatura dos cabeçalhos (`planilha/mapeamento.ts`):

- **Primeira vez do formato:** devolve `precisa_confirmar` com o mapeamento sugerido (data, hora, cupom, código de barras, produto, quantidade, preço unitário, total) e os campos obrigatórios que faltam. O dono confirma em `POST /documentos/planilhas/:id/confirmar` com `{ "mapeamento": { "data": "Data", ... } }`; o mapeamento fica em `mapeamento_planilha` por comerciante.
- **Formato já confirmado:** importa na hora, sem perguntar de novo.

Cada linha vira item de venda (`planilha/interpretar-linhas.ts`): data `dd/mm/aaaa` ou ISO, preço em centavos com `parseCentavos`, produto pelo código de barras e, sem ele, pelo nome normalizado do cadastro. O total da planilha, quando há, é conferido contra quantidade x preço. Linha que não dá para interpretar vai para o relatório (`linhas_rejeitadas`, com número e motivo) e as demais seguem; com rejeição o documento fica em `revisao`. Produto fora do cadastro é rejeitado, não criado. Quantidade aceita até 3 casas decimais (o banco guarda `numeric(14,3)`); nome que dois produtos compartilham não escolhe um, a linha é rejeitada e pede o código de barras. A planilha é lida antes de ser guardada (ilegível devolve 422 sem deixar arquivo), e se a importação falhar no meio o documento volta a `pendente` para o dono tentar de novo.

A venda é única por `(comerciante, data, cupom)`: reimportar o mesmo arquivo, ou outro que repita cupons, não duplica. Sem coluna de cupom, cada linha vira uma venda de um item, com cupom sintético prefixado pelo hash do arquivo (o mesmo arquivo repete os cupons, outra planilha no mesmo dia não colide). A importação é síncrona na requisição (a planilha da demo, com 11.365 linhas, leva cerca de 2 s).

Conferido contra o gabarito (`tests/planilha-vendas.e2e-spec.ts`): CSV e XLSX importam 3.623 cupons e 11.365 itens sem rejeição; em 2026-10-19 são 78 cupons e R$ 1.221,51.

## NF-e em XML (#29)

O mesmo `POST /documentos/notas` aceita o XML (o tipo vem dos primeiros bytes, não da extensão). `nfe/ler-nfe.ts` lê em código, sem modelo: parser SAX (`saxes`) que não lê DTD nem resolve entidades e recusa qualquer DOCTYPE (XXE, entidades em cascata). Os elementos casam pelo nome local, então prefixo de namespace e o layout antigo (`dEmi`) funcionam. Só entram emitente, data, itens (`xProd`, `uCom`, `qCom`, `vUnCom`, `vProd`), número e `vNF`; texto livre como `infAdic` é ignorado e nada do XML vira instrução. Dinheiro vem por texto e inteiro (`parseDecimalNfe`, até 10 casas, arredonda na 3ª), sem ponto flutuante. O total é o `vNF`.

O XML é lido antes de ser guardado (inválido devolve 422 e não deixa rastro). Depois passa pelas mesmas conferências da foto (`validarNota`) e pelo mesmo `gravarCompra`, na própria requisição e sem fila, com origem `nfe` e confiança 1 em compra e itens. Vínculo, perguntas e histórico de custo seguem o caminho da foto; como o vínculo por similaridade devolve a própria similaridade, o custo gravado pode ter confiança menor que 1. Nota com frete, desconto ou imposto que faz a soma dos itens divergir do `vNF` cai em `revisao` (`soma_diverge_do_total`) e o dono confirma.

Reenviar o mesmo arquivo é `duplicado`; o mesmo XML com espaços diferentes tem outro hash e vira outra compra. Conferido em `tests/ingestao-nfe.e2e-spec.ts` contra `fixtures/notas/nota-18`.

## Falhas

| Caso | Resultado |
| --- | --- |
| JSON fora do esquema | uma nova tentativa com o erro do Zod; depois `falha` (`json_invalido`) |
| Imagem ilegível, recusa, erro não transitório | `falha` na hora, nada gravado |
| Timeout, 408, 409, 429, 5xx | o BullMQ repete o job; `falha` só na última tentativa |
| Erro ao validar ou gravar (banco fora, restrição violada) | o BullMQ repete o job; na última tentativa o documento vira `falha` (`erro_gravacao`). A execução do modelo é registrada antes da gravação, então toda chamada cobrada fica auditada; no caminho de falha, o estado `falha` e o registro vão na mesma transação |
| Job repetido de documento já resolvido | ignorado, sem nova chamada ao modelo |

## Pendente nesta etapa

Sugestão de vínculo pelo modelo e código de barras no vínculo (#27). O aviso ao dono quando a extração falha depende do canal (#106, #66): hoje o estado fica em `documento.status` e `documento.erro`.
