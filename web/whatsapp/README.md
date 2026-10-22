# WhatsApp simulado (issue #179)

Tela de conversa com o Omnia que imita o WhatsApp Web, para o pitch. Não usa a API da Meta, mas segue as regras dela: o que aparece aqui é o que o canal real (#61 a #63) consegue enviar. Só a conversa: sem lista de chats, status ou configurações.

## Rodar

Sem build. Qualquer servidor estático serve a pasta:

```bash
python3 -m http.server 5180 --bind 127.0.0.1 --directory web/whatsapp
```

Abra `http://localhost:5180`. Parâmetros de URL: `?modo=demo` (padrão; `api` fica para a integração), `?painel=<url>` (botão "Abrir painel"), `?escala=1.4` (tamanho da letra), `?tema=claro`.

No menu de três pontos: receber o resumo das 7h (mensagem de modelo, no máximo 1 por dia), aumentar e diminuir a letra, trocar o tema e limpar a conversa. Arrastar uma foto para a conversa também envia.

Testes sem navegador: `npm run test:web` (regras da Meta, formatação de centavos e bps, e se toda resposta e todo botão do modo demonstração respeitam as regras).

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `index.html`, `estilo.css` | Estrutura e visual (tema escuro de 2025 do WhatsApp Web, claro como alternativa). Tamanhos em `em` a partir de `--escala`. |
| `app.js` | Liga composição, anexos, lista, menu e o transporte. |
| `render.js` | Desenha as bolhas por tipo de mensagem. Só nós DOM, nunca `innerHTML`. |
| `formato.js` | `*negrito*`, `_itálico_`, `~riscado~`, `` `código` `` e ` ```mono``` `. |
| `regras-meta.js` | Limites da Cloud API conferidos antes de mostrar uma mensagem do agente. |
| `modelos.js` | Modelos (templates) como seriam aprovados na Meta. |
| `transporte-demo.js` | Agente simulado com os números do gabarito (data de referência 2026-10-19). |
| `tipos.js` | Contrato entre a tela e o transporte (JSDoc). |

## Contrato do transporte

A tela só conhece a interface `Transporte` (`tipos.js`): `historico()`, `enviar(mensagem, arquivo?)`, `aoEvento(ouvinte)` e, opcional, `reiniciar()` e `simularProativa()`. Trocar a demonstração pelo backend é escrever outro transporte com a mesma interface.

Mensagens no formato da Cloud API, para o canal real reaproveitar o desenho:

- Do agente (`direcao: "saida"`): o corpo de `POST /{phone-number-id}/messages`. Tipos `text`, `image`, `document`, `interactive` (`button`, `list`, `cta_url`) e `template`.
- Do dono (`direcao: "entrada"`): o objeto `messages[]` do webhook. Tipos `text`, `image`, `document`, `interactive` (`button_reply`, `list_reply`) e `button` (toque em botão de modelo). Resposta a uma mensagem leva `context.id`.

Eventos que o transporte emite: `{ tipo: "mensagem", mensagem }`, `{ tipo: "status", id, status }` (`sent`, `delivered`, `read`, `failed`; só avança) e `{ tipo: "digitando", ativo }`. Na Cloud API, "lida" e "digitando" saem na mesma chamada de marcar como lida.

## Regras da Meta conferidas

`regras-meta.js` é o dono dos números: texto até 4096 caracteres, legenda até 1024, corpo interativo até 1024, cabeçalho e rodapé até 60, de 1 a 3 botões de resposta com título até 20, lista com até 10 linhas no total (título até 24, descrição até 72, texto do botão até 20), botão de link com texto até 20, foto JPEG ou PNG até 5 MB, documento até 100 MB, e janela de 24 h: sem mensagem do dono nas últimas 24 h, o agente só pode mandar modelo. Mensagem do agente que viola uma regra aparece como aviso tracejado em vermelho no lugar da bolha (o canal real receberia erro da Meta).
