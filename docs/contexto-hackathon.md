# Gestor automático para pequenos comércios: contexto para o AKCIT Camp
 
Oct 19, 2026 · @Eduardo de Brito Soares
 
O projeto é um agente de IA que avisa o dono do comércio pelo WhatsApp o que importa no negócio. Hoje ele é forte em solução e uso de IA, e fraco em validação com comerciantes, que vale 20% da nota e é o gap mais barato de fechar.
 
## Onde estamos em cada critério
 
A banca pontua cinco critérios, e Solução e Uso de IA sozinho vale 30%. Validação e Diferencial somam 40% e dependem de evidência que ainda não existe.
 
| Critério | Peso | Situação hoje | Próxima ação |
| --- | --- | --- | --- |
| Problema e validação | 20% | Dor apoiada em pesquisas públicas do Sebrae (RJ, RS, MT). Nenhuma entrevista própria | Fazer 5 a 10 entrevistas com donos de mercadinho ou conveniência |
| Solução e uso de IA | 30% | Arquitetura definida: o código calcula, o agente decide o que avisar | Prototipar 3 ferramentas do agente e um conjunto de perguntas de teste |
| Diferencial e viabilidade | 20% | Diferencial é ser proativo no WhatsApp. Custos ainda sem cotação | Cotar agregador e estimar custo por lojista por mês |
| Equipe | 15% | Perfil do autor é técnico (full-stack). Demais integrantes não informados | Registrar a jornada gamificada desde já |
| Qualidade do pitch | 15% | Roteiro ainda não escrito | Ensaiar 3 minutos com a demo do fluxo do agente |
 
## Problema e validação (20%)
 
A persona é o dono de pequeno comércio (mercadinho, conveniência, varejo ou atacado de pequeno porte), a confirmar nas entrevistas. Ele decide por intuição e sofre com três dores:
 
- Não sabe a margem real de cada produto.
- Percebe tarde o reajuste do fornecedor.
- Não tem tempo para analisar planilha ou sistema, e parte do público nem usa sistema.
 
Pesquisas públicas do Sebrae (RJ, RS e MT) indicam que qualidade, preço, flexibilidade de pagamento e prazo de entrega decidem a compra, e que o aumento de custos é a principal dificuldade. Atrasos de entrega e baixa capacidade de fornecimento também são relatados. Falta anexar os links dessas pesquisas.
 
A banca pede evidência de que o problema existe: entrevistas, dados ou feedback de usuários. Hoje só há evidência pública, não própria. O plano para fechar esse gap:
 
1. Entrevistar 5 a 10 donos de mercadinho ou conveniência.
2. Perguntar: como define o preço de venda, como e quando soube do último reajuste de fornecedor, se usa PDV ou caderno, se emite nota, para que usa o WhatsApp e quanto tempo gasta por semana com números.
3. Mostrar um relatório diário simulado no WhatsApp a pelo menos 3 donos e anotar o que perguntam e se pagariam.
4. Registrar cada conversa com data, perfil, citação literal e se a dor foi confirmada.
 
Meta sugerida, ajustável: metade dos entrevistados descreve um reajuste que percebeu tarde. Uma citação real dessas entrevistas deve abrir o pitch.
 
## Solução e uso de IA (30%)
 
O agente fica em segundo plano e fala com o dono pelo WhatsApp. O código calcula os números, e o modelo de linguagem decide o que vale avisar e como dizer.
 
1. O dono conecta a conta PJ uma vez (agregador de Open Finance), envia fotos de notas de compra e uma planilha de vendas.
2. Um modelo com visão extrai os itens das notas, com campo de confiança, e os dados vão para o PostgreSQL.
3. Jobs agendados calculam margem, giro, variação de custo e anomalias por código.
4. O agente recebe os candidatos a alerta, escolhe o que avisar hoje e escreve uma mensagem curta.
5. O dono responde no mesmo WhatsApp. O agente consulta as métricas por ferramentas ou pergunta o que falta.
 
O dono recebe um relatório diário curto (faturamento, gastos, saldo e comparação com dias anteriores), alertas de produto de maior giro, margem baixa ou com espaço para subir, reajuste de custo, estoque parado e gasto fora do padrão, e respostas a perguntas livres como "qual produto me dá mais lucro?".
 
Por que precisa ser agente, e não só um dashboard:
 
- Prioriza o que alertar para cada dono a cada dia, em vez de mostrar tudo.
- Pede a informação que falta, como "não achei o custo do item X, quanto você pagou?".
- Lê notas e recibos fotografados.
- Responde pergunta aberta na linguagem do dono.
- No futuro, sugere e executa ações com confirmação humana.
 
| Quem faz | O que faz |
| --- | --- |
| Código determinístico | Margem, giro, variação de custo, ticket médio e anomalias |
| Modelo de linguagem | Escolhe o que avisar, redige a mensagem, pergunta o que falta, extrai itens da nota e responde perguntas chamando ferramentas |
| Dono | Confirma qualquer ação com efeito financeiro |
 
Essa separação reduz o risco de número errado, porque o modelo nunca calcula: ele só comunica o que as ferramentas devolvem.
 
Em aberto: os parâmetros de avaliação de IA da seção 9.4 não vieram no material. Enviar o texto para alinhar esta seção a eles.
 
## Diferencial e viabilidade (20%)
 
O diferencial pretendido é ser proativo, via WhatsApp e sem curva de aprendizado. Conta Azul, Nibo, Bling, Tiny e Omie exigem que o dono acesse, configure e interprete; aqui o agente vai até o dono. Isso é hipótese a validar nas entrevistas.
 
A viabilidade depende de qual dado entra primeiro. Três regras externas já foram checadas e moldam essa escolha:
 
| Insight | Dado necessário | Fonte | O que já foi checado |
| --- | --- | --- | --- |
| Faturamento, fluxo de caixa e gastos | Entradas e saídas da conta PJ | Open Finance via agregador, como a [Pluggy](https://docs.pluggy.ai/pt/docs/overview) | A Pluggy tem sandbox para testar o fluxo inteiro sem credenciais reais. Há [tutoriais de conexão](https://docs.pluggy.ai/pt/docs/developer-tools/tutorials) de contas PJ de bancos como Itaú, Bradesco, Banco do Brasil, Inter e Santander. A cobertura PJ deve ser confirmada com a empresa |
| Produto que mais vende | Itens vendidos | PDV, NFC-e ou planilha de vendas | O Open Finance não entrega itens vendidos |
| Custo de compra e reajuste | Itens e preços das notas de compra | Foto da nota lida por modelo com visão, ou NF-e pela [Distribuição de DF-e](https://portalspedbrasil.com.br/?p=16011) | A consulta exige certificado digital. Sem manifestação do destinatário só vem o resumo da nota. O XML completo vem após manifestar ciência, confirmação ou operação não realizada, e fica disponível por até 3 meses |
| Margem por produto | Preço de venda e custo | Soma das duas fontes acima | Sem PDV, planilha ou nota, não há margem |
 
Custos de mensagem no [WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), segundo a documentação da Meta:
 
- A cobrança é por mensagem entregue, por categoria e país do destinatário. Template utilitário enviado dentro de janela de atendimento aberta é gratuito.
- Fora da janela de 24 horas só vão templates. O relatório diário proativo será template na maioria dos dias, e a categoria (utilitária ou marketing) muda o preço. Testar qual categoria a Meta atribui é tarefa do protótipo.
- Há cota gratuita de 1.000 mensagens de serviço por mês por número. Desde 1º de outubro de 2026, mensagens de serviço acima da cota são cobradas.
- A Meta só altera preços no primeiro dia de cada trimestre e publica tabelas em BRL. Contas em BRL estão disponíveis para empresas elegíveis desde 1º de julho de 2026.
 
Sobre o agregador, um [relato informal](https://www.tabnews.com.br/dalmiborba/b9ab022c-fa5e-4cbc-acc9-114056377a20) numa comunidade de desenvolvedores cita cerca de R$ 2.500 por mês para a Pluggy, sem fonte oficial. Tratar como alerta de custo e pedir cotação.
 
Modelo de negócio (hipótese): assinatura mensal por comércio. O custo por lojista por mês é agregador mais mensagens mais LLM, então o protótipo deve registrar o custo real de cada execução para definir o preço. O retorno mensurável seria margem recuperada ou reajuste evitado pagando a assinatura.
 
Escala: depois do primeiro tipo de comércio, replicar para outros. O módulo de fornecedores (alerta de reajuste e alternativas) volta como expansão.
 
## Equipe (15%)
 
A banca avalia perfil, complementaridade, aderência ao problema e evolução ao longo do programa. A evolução é comprovada pelo registro da jornada gamificada (seção 7.3 do edital).
 
Perfil atual:
 
- Edu: estudante de Ciência da Computação na UFG, com experiência como full-stack na ELO Júnior (NATI). A stack (TypeScript, Next.js, NestJS, PostgreSQL, Redis, Docker) é a mesma do projeto.
- Interesse em cibersegurança, útil para a parte de dados bancários e LGPD.
- Demais integrantes: não informados. Preencher aqui nome, papel e por que cada um é necessário.
 
Lacunas prováveis: vivência de comércio, para conduzir entrevistas e falar a língua do dono; design de conversa no WhatsApp; e conhecimento de finanças ou contabilidade para validar as métricas de margem.
 
Para mostrar evolução, manter um log semanal com entrevistas feitas, decisões e mudanças de rumo. O pivô de "agente que encontra fornecedores" para "gestor automático" já é um exemplo concreto de aprendizado e deve entrar no registro.
 
## Pitch de 3 minutos (15%)
 
A banca avalia clareza, objetividade e a capacidade de vender a solução em 3 minutos, incluindo o fluxo do agente na demo. O roteiro abaixo gasta o maior tempo na demo, porque é onde o uso de IA (30%) aparece.
 
| Tempo | Bloco | O que dizer ou mostrar | Critério |
| --- | --- | --- | --- |
| 0:00 a 0:25 | Dor | Uma citação real de entrevista sobre reajuste percebido tarde | Problema e validação |
| 0:25 a 0:45 | Persona e evidência | Quem é o dono, dados do Sebrae e número de entrevistas feitas | Problema e validação |
| 0:45 a 1:45 | Demo do agente | Foto da nota entra, a extração mostra a confiança, o código recalcula o custo, o agente detecta o reajuste e avisa no WhatsApp. O dono pergunta "qual produto me dá mais lucro?" e o agente responde com o número devolvido pela ferramenta | Solução e uso de IA |
| 1:45 a 2:15 | Por que agente | Código calcula, modelo comunica, humano confirma ações financeiras | Solução e uso de IA |
| 2:15 a 2:40 | Diferencial e viabilidade | Proativo no WhatsApp, custo por lojista estimado, plano de preço | Diferencial e viabilidade |
| 2:40 a 3:00 | Equipe e próximos passos | Jornada registrada, pilotos com lojistas e o papel do programa | Equipe |
 
Grave a demo antes como plano B, caso a rede ou o WhatsApp falhe na hora. Use dados reais ou de sandbox, sem expor dados bancários de ninguém.
 
## Riscos e decisão em aberto
 
A decisão em aberto é qual dado entra primeiro: nota de compra (gestor de margem) ou integração com PDV (gestor de caixa). A recomendação é começar por nota de compra mais planilha de vendas, porque margem e alerta de reajuste dependem do custo de compra, e a planilha dá os itens vendidos sem exigir integração. Se as entrevistas mostrarem que a maioria já usa PDV com exportação, inverter.
 
| Risco | Mitigação |
| --- | --- |
| Fricção de onboarding e desconfiança com dado bancário | Conexão feita uma vez, consentimento explícito e entrada inicial só com fotos de nota e planilha, sem banco |
| Margem errada leva a decisão errada | Mostrar nível de confiança, conferir a soma dos itens contra o total da nota e perguntar ao dono quando houver dúvida |
| Informalidade: parte do público não emite nota nem separa conta PJ | Perguntar nas entrevistas e aceitar foto de recibo e planilha |
| Certificado digital para NF-e: pode faltar ao pequeno comerciante, e a manifestação é registrada em nome do cliente | Confirmar nas entrevistas, usar foto de nota no MVP e exigir consentimento explícito se usar NF-e |
| Custo de mensagem, agregador e LLM acima do preço da assinatura | Medir custo por execução e limitar o número de mensagens por dia |
| Meta classificar o template diário como marketing, mais caro | Testar a categorização cedo, ainda no protótipo |
| LGPD e segurança de dados sensíveis | Mínimo de dados, criptografia, logs de acesso e consentimento |
 
## Fontes
 
Páginas abertas em 19 de outubro de 2026. Regras e preços da Meta mudam a cada trimestre, então reconfirmar antes do pitch.
 
- [Pricing on the WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Distribuição de DF-e e manifestação do destinatário (Portal SPED Brasil)](https://portalspedbrasil.com.br/?p=16011)
- [Visão geral da Pluggy](https://docs.pluggy.ai/pt/docs/overview)
- [Tutoriais de conexão de contas na Pluggy](https://docs.pluggy.ai/pt/docs/developer-tools/tutorials)
- [Comentário informal sobre preço da Pluggy (TabNews)](https://www.tabnews.com.br/dalmiborba/b9ab022c-fa5e-4cbc-acc9-114056377a20)
 
A anexar: links das pesquisas do Sebrae (RJ, RS e MT) usadas no levantamento da dor.
