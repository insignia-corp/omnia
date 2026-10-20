# ingestao

Foto de nota (modelo com visão + validação em código), planilha de vendas e NF-e. Issues: #22 a #29. Estado e pendências em [docs/ESTADO.md](../../docs/ESTADO.md).

## Caminho de uma foto

`POST /documentos/notas` (campo `arquivo`, cabeçalho `X-Comerciante-Id`) guarda o arquivo (`src/infra/armazenamento`), cria o `documento` como `pendente` e enfileira o job `extrair-nota` no BullMQ (3 tentativas, espera exponencial). O worker (`fila/fila-extracao.ts`) chama `ProcessadorExtracao`, que:

1. lê a imagem e chama o `ExtratorNotas` (`extracao/`), módulo isolado atrás da porta `ClienteVisao`;
2. confere a nota em código (`validacao/validar-nota.ts`): somas, quantidade x unitário, CNPJ e data. Divergência reduz a confiança e deixa o motivo, não descarta;
3. grava fornecedor, compra e itens numa transação (`gravar-compra.ts`) e deixa o documento em `extraido` ou `revisao`;
4. registra a execução (gatilho `extracao_nota`) com tokens, custo e latência.

`GET /documentos/:id` devolve status, motivos, compra e itens com a confiança de cada um.

## Falhas

| Caso | Resultado |
| --- | --- |
| JSON fora do esquema | uma nova tentativa com o erro do Zod; depois `falha` (`json_invalido`) |
| Imagem ilegível, recusa, erro não transitório | `falha` na hora, nada gravado |
| Timeout, 429, 5xx | o BullMQ repete o job; `falha` só na última tentativa |
| Job repetido de documento já resolvido | ignorado, sem nova chamada ao modelo |

## Pendente nesta etapa

Vínculo item-produto e histórico de custo (#27), pergunta ao dono por item duvidoso (#26), planilha (#28). O aviso ao dono quando a extração falha depende do canal (#106, #66): hoje o estado fica em `documento.status` e `documento.erro`.
