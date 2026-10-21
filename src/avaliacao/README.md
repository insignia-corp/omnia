# avaliacao

Harness de avaliação do agente (`npm run eval`). Issue #68; os casos de verdade são das issues #69 a #74. Metas e testes por agente: `docs/especificacao-agentes.md`, seção 8.

## Uso

```bash
npm run seed:demo                          # carrega o mercadinho (uma vez)
npm run eval                               # modo falso: modelo roteirizado, sem rede e sem custo
npm run eval -- --modelo real              # API da Anthropic; exige ANTHROPIC_API_KEY
npm run eval -- --caso q01,q33 --prompt v2
```

Sem `ANTHROPIC_API_KEY`, `--modelo real` para antes de tocar no banco, com a mensagem do que falta. A CLI sai com 1 se algum caso falhar (serve de portão na CI) e com 2 em erro de uso.

## O que sai

- `docs/avaliacoes/AAAA-MM-DD-<versao-prompt>-<modelo>.md`: relatório da rodada, versionado no git. No modo falso o sufixo é `falso`, para a rodada da CI não sobrescrever a de um modelo real do mesmo dia. Traz acertos por categoria, falhas com o motivo, custo e latência por execução, modelo e versão do prompt.
- `evidencias/AAAA-MM-DD-eval-<modo>-<hhmmssmmm>.json`: saída bruta (mensagem e chamadas de cada caso). Fica fora do git e nunca é sobrescrita (colisão ganha `-2`, `-3`). O relatório de mesmo dia, prompt e modelo é substituído; o git guarda o anterior.
- Cada execução também entra em `execucao_agente` (e `chamada_ferramenta`) do mercadinho. `npm run seed:demo` limpa.

## Como funciona

| Arquivo | Papel |
| --- | --- |
| `tipos.ts` | `CasoAvaliacao`, `Criterio`, `ResultadoCaso`, `Rodada` |
| `criterios.ts` | Julga um caso lendo a execução registrada: ferramentas esperadas e o critério (`numero_correto`, `bloqueio_verificador`, `sem_resposta`) |
| `runner.ts` | Roda os casos em sequência pelo `AgenteService` e junta o veredito com custo, latência e chamadas |
| `relatorio.ts` | Resumo por categoria, Markdown do relatório e gravação |
| `rodada.ts` | Liga tudo: escolhe o modelo pelo modo, acha o comerciante do seed, monta o agente como o `AgenteModule` monta |
| `modelo-roteirizado.ts` | `ModeloLinguagem` do modo falso (`texto`, `chamar`) |
| `casos/` | Casos. `perguntas.ts` lê `fixtures/avaliacao/perguntas.json`; `numericas.ts` (q01 a q32, #69), `verificador.ts` (v01 a v05, #70) e `sem-resposta.ts` (q33 a q40, #72); `index.ts` junta |

Um caso declara: `entrada`, `gatilho`, `ferramentasEsperadas` (todas têm de ser chamadas) e `criterio`. Para o modo falso traz também o `roteiro` do modelo e, se precisar, `ferramentasFalsas`: dublês que ocupam o lugar da ferramenta de mesmo nome do catálogo enquanto o plano A não a entrega. No modo real só vale o catálogo de `montarCatalogo`.

Regras dos critérios:

- Dinheiro do gabarito vem em centavos e a mensagem o escreve em reais (`122151` vira "R$ 1.221,51"). Percentual compara o módulo; o sentido (queda, alta) vem da palavra e ainda não é conferido.
- `bloqueio_verificador`: o número barrado não pode aparecer na mensagem final, e o fallback do verificador não pode ter número.
- `numero_correto` com `textos` exige também os nomes do gabarito (produto, fornecedor) na mensagem, sem diferenciar maiúscula nem acento.
- `numero_correto` com dois ou mais números da mesma unidade exige `contexto` em cada um (ex.: `/ontem/`, `/28 dias|anteriores/`): sem isso, a resposta com os valores trocados passaria. O contexto é procurado entre o número anterior e o seguinte da mensagem. O harness recusa o caso antes de rodar.
- `sem_resposta`: aprovada, sem nenhum número e dizendo que não sabe ou o que falta. O padrão padrão pede "não sei", "não tenho dados" e variantes; o caso pode declarar `padraoNaoSei` mais específico (o q33 declara).
- Data de referência (`--data` ou do caso) tem de existir no calendário, senão a rodada nem começa.

## Para acrescentar casos (#73, #74)

Crie `casos/<tema>.ts` exportando uma lista de `CasoAvaliacao` e some-a em `casos/index.ts`. Números esperados saem de `perguntas.json`, nunca digitados à mão. Critério novo (injeção, ação com confirmação, escolha de ferramenta) entra como mais um `tipo` em `criterios.ts`.

## Extração de notas (#71)

O Extrator tem runner próprio em `extracao/`, porque o que se mede é outro: foto de nota contra o gabarito de `fixtures/notas/`, sem banco e sem agente.

```bash
npm run eval:extracao                       # modo falso: o cliente de visão devolve o gabarito, sem rede e sem custo
npm run eval:extracao -- --modelo real      # modelo com visão da Anthropic; exige ANTHROPIC_API_KEY (usa EXTRATOR_MODELO)
npm run eval:extracao -- --nota nota-10,nota-11 --limite 0.7
```

Cada foto (17, a NF-e em XML fica de fora) passa pelo `ExtratorNotas` e pelas validações em código (`validarNota`), na ordem do processador da ingestão, e o que seria gravado é comparado com o gabarito. A CLI sai com 1 se uma meta falhar e com 2 em erro de uso. Relatório em `docs/avaliacoes/AAAA-MM-DD-extrator-v1-<falso|modelo>.md` e saída bruta em `evidencias/`, como no harness do agente. O modo falso só prova o caminho: os números de acerto valem na rodada com modelo real.

| Arquivo | Papel |
| --- | --- |
| `extracao/comparador.ts` | `compararNota` (função pura): campos do documento e de cada item, soma, CNPJ; `classificarConfianca`: onde a confiança deixa o erro passar |
| `extracao/runner.ts` | Carrega as fotos e o gabarito, passa cada foto pelo Extrator e pelas validações, guarda custo e latência; cliente falso do gabarito |
| `extracao/relatorio.ts` | Resumo, metas, calibração do limite, relatório em Markdown e gravação |
| `extracao/rodada.ts` | Liga tudo e escolhe o cliente pelo modo; lê só `ANTHROPIC_API_KEY`, `EXTRATOR_MODELO`, `LLM_TIMEOUT_MS` e `LIMITE_CONFIANCA_ITEM` (não exige banco nem Redis) |

Regras da comparação:

- Dinheiro em centavos inteiros, igualdade exata. Texto sem acento, sem diferenciar maiúscula e com espaços colapsados. CNPJ sem máscara. Quantidade com 3 casas, como o banco guarda.
- Os itens casam pela descrição igual e, os que sobram, pela ordem; assim um nome mal lido é um erro de `descricao`, não um item omitido mais um a mais.
- O gabarito traz a confiança como marcador (1 ou 0,5); compara-se o lado do limite, não o valor. Item e documento saem do Extrator já com a confiança reduzida pelo código (soma, CNPJ, data, conta do item).
- Erro sinalizado: erro de campo de item com o item abaixo do limite, ou qualquer erro com o documento abaixo do limite (o dono confirma a nota inteira). Erro silencioso: o resto. Nota que o Extrator não devolveu (`ilegivel`, `json_invalido`, recusa, erro de API) conta como um erro sinalizado, porque o documento fica com status de erro.
- Metas (especificação dos agentes, seção 8): total correto em pelo menos 90% das notas e nenhum erro silencioso. A tabela de calibração relê a rodada com outros limites; o limite certo é o menor que deixa zero erro silencioso.

## Fora do harness

Não mede a escolha dos 3 alertas do relatório (falta o top 3 aceitável no gabarito; ver a seção 8 da especificação).
