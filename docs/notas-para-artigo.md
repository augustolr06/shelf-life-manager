# Notas para o Artigo do TCC

Este arquivo reúne pontos de decisão, descobertas técnicas e limitações relevantes para escrever o artigo — não é um changelog técnico (isso é `docs/decisoes.md`), é material bruto de "problema → solução" pra consultar na hora de redigir.

Não edite entradas antigas — só adicione novas. Se uma decisão for revista mais tarde, registre a revisão como nova entrada, referenciando a anterior.

## Formato de cada entrada

```
## <título curto>

**Contexto do problema:** o que, na prática manual (sem lotes, controle por
planilha/memória/experiência da vendedora), motiva essa decisão ou é
evidenciado por ela.

**Alternativas consideradas:** (se houver)

**Solução adotada:** o que foi implementado.

**Por que resolve o problema / trade-offs:** o que se ganha e o que se
paga por isso — inclua limitações honestamente, não só os pontos fortes.

**Tarefa relacionada:** TNN

**Data:**
```

---

## QR Code por unidade física, não por lote

**Contexto do problema:** o controle manual em lojas de pequeno porte, quando existe, costuma tratar o estoque por lote ou por SKU — a mesma granularidade que sistemas de gestão convencionais usam. Mas o comércio real de produtos pequenos e perecíveis (ex: perfumaria) recebe entregas mistas, em que unidades do MESMO produto trazem validades DIFERENTES dentro da mesma caixa. Controle por lote não resolve isso: obriga a vendedora a inferir manualmente qual unidade física pegar — exatamente o processo propenso a erro que este trabalho busca substituir.

**Alternativas consideradas:** controle por lote (uma validade por recebimento, aplicada a todas as unidades daquele lote). Mais simples de implementar, mas inválido para o cenário de entrega mista descrito acima — é o modelo que os sistemas convencionais já oferecem e que não resolve o problema.

**Solução adotada:** cada unidade física recebe um código QR único e uma `dataValidade` própria, independente das demais unidades do mesmo produto (ver `docs/arquitetura.md` seção 3, entidade `UnidadeProduto`).

**Por que resolve o problema / trade-offs:** permite que a validação FIFO opere no nível da unidade física real — o nível em que a vendedora efetivamente decide, na prática, qual frasco tirar da prateleira — em vez do nível abstrato do lote, que esconde a variação de validade que motiva o problema. O custo é operacional: cada unidade individual precisa ser fisicamente etiquetada, o que exige um fluxo próprio de geração e impressão de etiquetas (RF04) que um sistema por lote dispensaria.

**Tarefa relacionada:** T05 (cadastro por unidade), T14 (geração de QR)

**Data:** 2026-08-25

---

## Produto nunca é excluído: o histórico é o dado da pesquisa

**Contexto do problema:** no controle manual, um produto que sai de linha simplesmente some — a linha é apagada da planilha, ou o caderno vira. Junto com ele some o histórico de quantas unidades daquele item venceram na prateleira. Essa é exatamente a informação que motiva o trabalho: sem ela, a loja não consegue dizer quanto perde por vencimento, nem quais itens concentram a perda, e a decisão de compra segue baseada em impressão.

**Alternativas consideradas:** exclusão física (`DELETE` no banco), que é o comportamento que a palavra "excluir" sugere ao usuário e o padrão de um CRUD convencional. Descartada porque um produto com unidades já vendidas ou descartadas não pode ser removido sem levar junto o histórico — e o log de eventos, que é append-only por exigência de projeto, ficaria referenciando um produto que não existe mais.

**Solução adotada:** `Produto` tem um campo `ativo`, e a operação de exclusão da interface apenas o marca como `false`. O produto some das listagens operacionais por padrão, mas continua no banco, e um filtro explícito o traz de volta. A operação tem desfazer.

**Por que resolve o problema / trade-offs:** preserva a série histórica que sustenta os indicadores de perda, sem exigir que o usuário entenda a diferença entre "inativar" e "excluir" — para ele, o produto sumiu da tela. O custo é que o banco cresce monotonicamente e que o catálogo real acumula itens inativos, o que exige que toda consulta operacional futura (cadastro de unidade, leitura de QR) lembre de filtrar por `ativo`. É uma limitação a mencionar honestamente: o sistema troca simplicidade de manutenção por integridade do histórico, e essa troca só se justifica porque o histórico é o objeto do trabalho.

**Tarefa relacionada:** T04

**Data:** 2026-09-07

---

## Unidade vencida pode ser cadastrada: o sistema precisa aceitar o estoque como ele está

**Contexto do problema:** o controle manual não tem um momento de "cadastro". O estoque simplesmente existe na prateleira, e a loja descobre o que tem quando olha. Ao informatizar, aparece uma tentação natural: exigir que todo item entrando no sistema esteja válido, porque um item vencido "não deveria estar lá". O problema é que ele está — e é justamente o item que a loja mais precisa que o sistema conheça. Um frasco vencido esquecido no fundo da prateleira é a perda que o trabalho quer medir, e o risco que quer evitar que chegue ao cliente.

**Alternativas consideradas:** recusar o cadastro de unidade com validade passada, obrigando a loja a descartar o item antes de registrá-lo. Descartada porque inverte a ordem real dos fatos: o descarte é uma decisão que precisa ser registrada, com autor e motivo (seção 6.1 do PRD), e exigi-lo *antes* do cadastro significa que ele acontece fora do sistema — sem registro, sem responsável, sem entrar na conta de perdas. O sistema ficaria sabendo apenas do estoque que já estava certo.

**Solução adotada:** o cadastro aceita qualquer validade e devolve um aviso quando a unidade entra já vencida, dizendo quantas unidades e de qual validade. A unidade entra em estoque normalmente, com código próprio, e será barrada na venda pelo fluxo de exceção previsto para unidade vencida.

**Por que resolve o problema / trade-offs:** separa duas decisões que o processo manual mistura — "este item existe" e "este item pode ser vendido". A primeira é um fato e o sistema apenas registra; a segunda é um julgamento, e tem um fluxo próprio com autor e justificativa. O custo é que o estoque do sistema passa a conter itens que não podem ser vendidos, e a interface precisa deixar isso visível para não parecer erro. É também o que torna possível a migração inicial: a loja pode cadastrar a prateleira como ela está hoje, sem precisar limpá-la antes.

**Tarefa relacionada:** T05 (cadastro), T11 (exceção de unidade vencida)

**Data:** 2026-09-07

---

## Quantidade por validade: o formulário reproduz o gesto da conferência

**Contexto do problema:** o modelo do sistema é a unidade física — cada frasco é uma linha no banco, com código próprio (ver a nota sobre QR por unidade). Mas o gesto real do recebimento não é unidade a unidade: a gestora abre a caixa, lê **uma** validade impressa e conta quantos frascos vieram com ela. Um formulário fiel ao modelo de dados pediria doze linhas idênticas para doze frascos da mesma validade, e obrigaria a redigitar a data doze vezes — no campo que é o objeto inteiro do trabalho.

**Alternativas consideradas:** manter uma linha por unidade, o que é a tradução literal do modelo. Descartada por multiplicar a chance de erro de digitação exatamente onde ele custa mais caro: uma validade digitada errada não é detectável depois — o sistema vai ordenar a saída FIFO por um dado falso e continuar parecendo correto.

**Solução adotada:** cada linha do recebimento é um par (validade, quantidade), e o servidor expande a linha em N unidades independentes, cada uma com seu próprio código. O modelo de dados não muda: quem olha o banco vê N unidades separadas, como se tivessem sido cadastradas uma a uma.

**Por que resolve o problema / trade-offs:** é um caso em que a interface deve reproduzir o gesto do operador e não o formato do banco, e a tradução entre os dois é responsabilidade do servidor. O trade-off honesto é que a contagem passa a depender do operador — se ele digitar 12 e a caixa tiver 11, o sistema acredita nele, e a divergência só aparece quando faltar um frasco na leitura de QR. Um controle manual tem exatamente o mesmo furo; o sistema não o resolve, apenas não o piora.

**Tarefa relacionada:** T05

**Data:** 2026-09-07

---

## Data de validade é calendário, não instante — e o fuso é uma armadilha silenciosa

**Contexto do problema:** "vence em 01/03/2027" é um fato de calendário: não tem hora, e não muda conforme quem está olhando. A representação usual de data em sistemas, porém, é um instante no tempo, ancorado num fuso. A consequência aparece nas duas pontas: uma validade digitada como 01/03 pode ser gravada como 28/02, e a pergunta "esta unidade está vencida hoje?" pode mudar de resposta às 21h, quando o dia vira em UTC mas ainda é ontem na loja.

**Alternativas consideradas:** guardar a validade como instante com hora zero no fuso local, que é o comportamento padrão da maioria dos ORMs quando se converte uma data. Descartada porque o erro é silencioso — não gera exceção, não aparece em teste que rode na mesma máquina do banco, e só se manifesta como um item ordenado errado na fila FIFO ou como um vencimento que antecipa um dia.

**Solução adotada:** a coluna é do tipo `DATE`, sem hora, e a conversão entre o texto `AAAA-MM-DD` que trafega na API e o valor gravado passa por um único par de funções. "Hoje" é sempre derivado do calendário local de quem opera a loja, e só então normalizado; a validade é montada a partir de ano, mês e dia explícitos, nunca interpretada a partir de texto solto.

**Por que resolve o problema / trade-offs:** é a diferença entre o sistema estar certo e o sistema *parecer* certo na máquina de quem o desenvolveu. A verificação que dá confiança não é o teste unitário — é conferir o valor gravado direto no banco, com o servidor num fuso e o relógio local em outro, que foi o que se fez aqui. A limitação a mencionar: a solução assume uma loja num único fuso horário, o que é verdade para o caso estudado e deixaria de ser numa rede com filiais distantes.

**Tarefa relacionada:** T05 (cadastro), T07 (validação FIFO, que compara validade com "hoje")

**Data:** 2026-09-07

---

## FIFO por validade é uma ordem parcial: o empate revela o limite da regra

**Contexto do problema:** a regra que o trabalho propõe se enuncia como "saia sempre a unidade que vence primeiro". Enunciada assim, ela parece designar *uma* unidade — e é assim que a vendedora entende a instrução, e assim que o processo manual a descreveria. Ao escrever os casos de teste antes da implementação, apareceu o caso que a formulação esconde: duas unidades do mesmo SKU com **exatamente a mesma** data de validade. Numa entrega mista isso não é raro, é o caso comum — a caixa costuma trazer vários frascos de uma validade e alguns de outra.

**Alternativas consideradas:** desempatar por um segundo critério (data de entrada, ordem de cadastro, identificador) e apontar uma única unidade como a correta. É o que uma implementação ingênua faz naturalmente, porque a consulta devolve uma linha e é fácil tratá-la como *a* resposta. Descartada ao perceber a consequência no balcão: a vendedora que pegou a "errada" veria o sistema exigir um frasco **fisicamente indistinguível** do que está na mão dela — mesma marca, mesmo produto, mesma data impressa. Ela não teria como encontrar o frasco pedido a não ser lendo os QR de todos os frascos da prateleira até acertar. O laço de revalidação, que existe para corrigir a escolha, viraria um obstáculo sem saída.

**Solução adotada:** o veredito considera prioritária **qualquer** unidade cuja validade seja igual à menor validade do pool não-vencido. Havendo empate, ler qualquer uma das empatadas confirma a venda. Há caso de teste para as duas.

**Por que resolve o problema / trade-offs:** a descoberta é sobre o problema, não sobre o código. FIFO por data de validade produz uma ordem **parcial** sobre as unidades, não uma fila — e a diferença só é visível quando se pergunta o que o sistema faz com dois itens equivalentes. Um sistema que impõe uma ordem total onde o mundo tem empate está inventando uma distinção que a prateleira não tem, e transfere para a operadora o custo de descobrir uma diferença invisível. O trade-off é que o sistema abre mão de determinismo: duas execuções sobre o mesmo estoque podem baixar frascos diferentes. Isso é irrelevante para o objetivo — o que se quer garantir é que nenhuma unidade de validade *maior* saia antes de uma de validade *menor*, e essa garantia é preservada. Vale a menção honesta de que a validação por unidade física não elimina a necessidade de ler o QR: ela apenas garante que a leitura errada seja detectada.

**Tarefa relacionada:** T06 (caso de teste), T07 (implementação)

**Data:** 2026-09-07

---

## O número de tentativas não tinha onde morar — e isso diz algo sobre o que se está medindo

**Contexto do problema:** a variável que o trabalho quer medir não é só a perda por vencimento; é o comportamento que a produz. "Quantas vezes a vendedora pegou o frasco errado antes de pegar o certo" é o indicador que mostra se a regra FIFO está corrigindo uma escolha que, sem o sistema, teria virado uma unidade parada na prateleira até vencer. No processo manual esse número simplesmente não existe: não há evento de "tentativa", porque não há nada que verifique a escolha. A vendedora pega um frasco e pronto — o erro não é registrado porque não é detectado.

**Alternativas consideradas:** persistir um contador na unidade ou numa sessão de venda no servidor. Descartada por decisão anterior do projeto de não manter estado intermediário entre a leitura e a confirmação: cada item é um ciclo independente, e um ciclo abandonado (o cliente desistiu, a vendedora foi atender outra pessoa) não deve deixar nada para limpar. A outra alternativa era o cliente gerar um identificador de ciclo e enviá-lo, o que devolveria ao aplicativo do celular uma parte do controle do laço — justamente o que o projeto decidiu manter no servidor.

**Solução adotada:** o contador é **derivado do log de eventos**, não armazenado. O número de tentativas do ciclo corrente é quantos alertas de FIFO foram registrados para aquele produto e aquela vendedora desde a última venda confirmada dessa mesma dupla. Nada é gravado além do que já seria gravado como auditoria.

**Por que resolve o problema / trade-offs:** o log de eventos deixa de ser só instrumento de auditoria e passa a ser a única fonte de um dado da pesquisa que não existe em lugar nenhum do processo manual — não porque ninguém o anotou, mas porque o processo manual não tem o evento. É um argumento útil para o artigo: a instrumentação não é um acessório do sistema, é parte do que ele torna observável. Os trade-offs são reais e devem ser ditos. Primeiro, o ciclo é inferido, não delimitado: se a vendedora for barrada num produto, desistir e voltar horas depois ao mesmo produto, o sistema conta as tentativas antigas junto. Segundo, a definição amarra o ciclo à dupla (produto, vendedora) — duas vendedoras atendendo clientes diferentes do mesmo perfume têm contadores separados, o que é o desejado, mas uma vendedora atendendo dois clientes ao mesmo tempo do mesmo perfume teria os dois ciclos somados. Para a escala de uma perfumaria de pequeno porte o erro é desprezível; numa operação de maior volume, a delimitação explícita do atendimento passaria a ser necessária.

**Tarefa relacionada:** T06 (definição), T07 (implementação), T20 (dashboard que consome o indicador)

**Data:** 2026-09-07

---

## O que a concorrência ameaça não é a integridade do estoque — é a inteligibilidade do erro

**Contexto do problema:** o balcão de uma perfumaria pequena tem duas ou três atendentes e um estoque compartilhado. O caso que preocupa é banal: duas atendentes lêem o QR do **mesmo** frasco quase ao mesmo tempo — uma porque acabou de tirá-lo da prateleira, outra porque o cliente desistiu e ela devolveu o item ao balcão onde a colega o pegou. No controle manual esse conflito não existe como evento: não há registro de "saída", então nada há a duplicar. Ao informatizar, ele aparece — e a primeira reação é tratá-lo como problema de integridade de dados.

**Alternativas consideradas:** confiar na restrição de unicidade do banco (uma unidade tem no máximo uma saída). Ela sozinha **já impede** a dupla baixa: a segunda transação viola a restrição e é abortada. É uma solução correta, barata, e que passaria numa verificação que só perguntasse "o estoque ficou consistente?".

**Solução adotada:** a validação e a baixa acontecem numa única transação, com a unidade lida bloqueada explicitamente antes de qualquer decisão. A transação perdedora espera a vencedora terminar, relê a unidade já baixada e sai pelo caminho normal do sistema — o mesmo veredito que apareceria se alguém lesse um frasco vendido ontem.

**Por que resolve o problema / trade-offs:** a diferença entre as duas soluções não está no banco, que fica consistente nas duas; está na **forma da falha** que chega ao balcão. Sem o bloqueio, a segunda atendente recebe uma violação de restrição de unicidade — um erro de infraestrutura, no meio de um atendimento, sem tradução possível para a tela e sem instrução do que fazer. Com o bloqueio, ela recebe "esta unidade já foi baixada", que é uma frase que ela entende e sobre a qual ela sabe agir. A verificação que separou as duas foi remover o bloqueio e reexecutar os testes: as asserções de integridade continuaram passando, e só as que olhavam *como* a segunda leitura falhava ficaram vermelhas. É um argumento que vale para o artigo além deste caso: num sistema que substitui um processo manual, a correção do dado é o requisito mínimo, e a legibilidade da recusa é o que decide se o sistema é usável no balcão — a operadora não tem a quem recorrer no meio de uma venda. Trade-off honesto: o bloqueio serializa as leituras de uma mesma unidade, e por isso ele é da unidade física, nunca do produto; travar o SKU inteiro faria duas atendentes vendendo frascos diferentes do mesmo perfume esperarem uma pela outra, trocando um problema raro por uma lentidão constante.

**Tarefa relacionada:** T06 (caso de teste), T07 (implementação)

**Data:** 2026-09-08

---

## O bloqueio não é um erro: por que o código de status HTTP virou uma decisão de projeto

**Contexto do problema:** o comportamento central do sistema — barrar a saída do frasco errado e apontar o certo — é, do ponto de vista de quem programa, "a requisição não deu certo". A tentação é traduzir isso no protocolo: devolver um código de erro HTTP, como se faz com dado inválido. É uma escolha que parece técnica e trivial, e não é nem uma coisa nem outra.

**Alternativas consideradas:** mapear cada veredito num código de status (não encontrado, conflito, e assim por diante), que é a convenção usual em APIs. A alternativa adotada foi responder sempre "requisição bem-sucedida" para toda leitura que o sistema conseguiu processar, com o veredito no corpo da resposta, reservando os códigos de erro para o que não chegou a ser leitura (sessão ausente, requisição malformada, falha do servidor).

**Por que resolve o problema / trade-offs:** três consequências, e nenhuma delas é de estilo. A primeira é de interface: bibliotecas de rede e programadores tratam resposta de erro pelo caminho de exceção, e caminho de exceção atrai mensagem genérica — "algo deu errado, tente novamente". Seria a frase errada exatamente no momento mais importante do sistema, quando a vendedora precisa ler uma instrução específica ("devolva este frasco, pegue o de validade tal"). O bloqueio não é o sistema falhando; é o sistema funcionando. A segunda é de instrumentação, e é a mais concreta: o aplicativo é um PWA, e a camada de rede do navegador pode repetir automaticamente requisições que falharam. Uma repetição dessas gera um segundo registro de leitura no log — e o log é o instrumento de coleta da pesquisa, cujo indicador central (a taxa de acerto na primeira leitura) tem justamente o número de leituras no denominador. Codificar o veredito no protocolo colocaria o comportamento de retry da rede dentro da estatística do trabalho. A terceira é operacional: se a interação mais frequente do balcão for contabilizada como erro, a taxa de erro do serviço deixa de servir para detectar que o serviço está com problema. Trade-off honesto: a escolha contraria a convenção que um leitor de API espera, e por isso ela precisa estar documentada — o que se ganha é que existe um único campo a interpretar, e ele vem do servidor, coerente com a decisão de projeto de que o cliente nunca decide o veredito.

**Tarefa relacionada:** T08 (endpoint de leitura), T10 (tela que consome o veredito)

**Data:** 2026-09-08

---

## Uma especificação pode ser internamente incoerente sem que ninguém perceba — até alguém tentar implementá-la

**Contexto do problema:** o documento de arquitetura do projeto descreve, numa seção, a função de validação como fazendo tudo de uma vez: ao reconhecer que o frasco lido é o correto, ela registra a saída e baixa a unidade dentro da mesma transação. Em outra seção, a tabela de endpoints da API lista uma operação separada de "confirmar saída", posterior à leitura. As duas descrições convivem no mesmo documento, escritas em momentos diferentes, e nenhuma revisão as pegou. Só ao expor a função pela API é que a contradição aparece: se a leitura já efetivou a venda, a confirmação não tem o que confirmar.

**Alternativas consideradas:** resolver na hora, escolhendo o modelo de dois passos (ler, mostrar, confirmar) por ser o que a tabela de endpoints previa. Isso exigiria ou revalidar a regra inteira na segunda chamada — porque aceitar o veredito que o cliente afirma seria justamente o furo que o projeto fecha ao manter a decisão no servidor — ou reservar a unidade entre as duas chamadas, que é o estado intermediário que o projeto decidiu não ter. A primeira opção quebraria a função em duas ("decidir" e "efetivar") e invalidaria a bateria de testes escrita antes da implementação, que o método do trabalho manda não editar depois.

**Solução adotada:** registrar a incoerência de forma datada e explícita, implementar a tarefa corrente sobre o comportamento que já está testado, e empurrar a escolha para a tarefa que é dona daquele endpoint. A resposta da leitura foi redigida como fato consumado ("saída registrada"), para não induzir na tela um passo que não existe.

**Por que resolve o problema / trade-offs:** a observação que interessa ao artigo não é qual dos dois modelos vence — é que a incoerência era invisível enquanto o documento era só documento. Ela não apareceu na revisão do texto; apareceu quando uma parte do sistema precisou consumir a outra. Isso é um argumento a favor do método de desenvolvimento adotado (fatias verticais, cada uma consumindo a anterior) e um contraponto honesto à ideia de que a especificação precede a implementação: aqui a implementação **auditou** a especificação. Vale mencionar também o custo da disciplina: seria mais rápido decidir na hora, e mais barato no curto prazo; o que se ganha ao adiar é que a decisão passa pelo orientando, com as duas consequências à vista, em vez de ser tomada de passagem por quem estava com o editor aberto. Do ponto de vista de produto, a escolha entre um e dois passos não é cosmética — ela decide se uma leitura acidental vende o item, o que num balcão real exige um caminho de estorno que o projeto ainda não tem.

**Tarefa relacionada:** T08 (onde apareceu), T09 (onde precisa ser decidida)

**Data:** 2026-09-08

---

## Vender é irreversível no sistema porque ler já é vender — e o estorno é trabalho futuro

**Contexto do problema:** a incoerência registrada na nota anterior foi resolvida a favor do modelo de um passo: ler o QR do frasco certo **é** registrar a venda. A operação separada de confirmação saiu da especificação. Isso torna o fluxo do balcão o mais curto possível — um gesto, um veredito, pronto — e é coerente com a decisão de não manter estado intermediário no servidor, que elimina reserva, timeout e ciclo abandonado como classes inteiras de problema.

**Alternativas consideradas:** o modelo de dois passos, descartado porque nenhuma de suas formas honestas cabe nas restrições do projeto — revalidar a regra inteira na segunda chamada quebraria a função única de validação em duas, e reservar a unidade entre as chamadas é o estado intermediário que se decidiu não ter.

**Solução adotada:** um passo, com a resposta redigida como fato consumado, e a limitação declarada em vez de disfarçada.

**Por que resolve o problema / trade-offs:** a consequência precisa aparecer no artigo com todas as letras, porque ela não é hipotética num balcão real: uma leitura acidental — o frasco passa perto do leitor, a atendente lê o item errado do cliente errado — **vende** a unidade, e o sistema não oferece caminho de volta. Não há estorno, não há cancelamento de saída, e não pode haver correção da linha no log, que é imutável por decisão de projeto. O que existe hoje é a possibilidade de registrar um evento novo que descreva o engano, mas nenhuma tela para isso e nenhuma reversão do status da unidade. É uma limitação real de escopo, e ela decorre de duas escolhas que o trabalho defende por outras razões (fluxo curto e log imutável) — o que a torna mais interessante de discutir do que se fosse um simples esquecimento. Trabalho futuro: um caminho de estorno que seja append-only por construção, isto é, que reverta o estoque **acrescentando** um evento de anulação em vez de apagar a saída, preservando no dado da pesquisa tanto a venda quanto o arrependimento.

**Tarefa relacionada:** T08 (onde a incoerência apareceu), T09 (onde foi decidida)

**Data:** 2026-09-08

---

## Um log de pesquisa precisa ser protegido de quem o mantém, não de quem o ataca

**Contexto do problema:** o registro de eventos deste sistema tem dois papéis ao mesmo tempo: auditoria operacional e **instrumento de coleta dos dados quantitativos da pesquisa**. É dele que sai o indicador central do trabalho — quantas leituras acertaram o frasco certo de primeira. O requisito diz que ele é imutável, e a implementação inicial cumpria isso da forma usual: o código simplesmente nunca emitia uma alteração. A regra estava no documento de convenções do projeto e na revisão de código, e em nenhum outro lugar.

**Alternativas consideradas:** manter a disciplina de código, eventualmente reforçada por uma trava na própria camada de acesso ao banco, que recusasse alteração e remoção nessa tabela. É a solução idiomática, fica toda na linguagem do projeto e não exige SQL escrito à mão.

**Solução adotada:** a proibição foi movida para dentro do banco de dados, como um gatilho que recusa alteração e remoção de qualquer linha da tabela, com mensagem que explica a razão e sugere o que fazer no lugar.

**Por que resolve o problema / trade-offs:** a diferença entre as duas soluções fica clara quando se pergunta **qual é o risco realista**. Não é o programa alterar uma linha por engano — isso a revisão de código pega. É uma pessoa, durante o piloto na loja, abrir a ferramenta administrativa do banco e "corrigir" um registro que parece errado: uma validade digitada torto, um evento que ficou com o usuário trocado, uma leitura de teste que "sujou" os dados. A intenção é boa, o gesto é comum em qualquer projeto pequeno, e o efeito é falsear o resultado da pesquisa sem deixar rastro — porque o log é a própria testemunha, e ele foi editado. Uma trava na aplicação não alcança esse caminho; o gatilho no banco alcança todos. Duas observações valem para o artigo além deste caso. A primeira é que a mensagem de recusa foi escrita para **ensinar** em vez de só barrar: ela diz que um evento gravado não se corrige, se complementa com um evento novo. Um "permissão negada" seco convidaria a desativar a trava em vez de entender por que ela existe — e quem tem acesso ao banco tem acesso para desativá-la. A segunda é que a proibição foi calibrada e não maximizada: ela cobre alteração e remoção de linhas, mas deliberadamente não impede o esvaziamento completo de um banco descartável, que é o que permite a bateria de testes automatizados continuar funcionando. Imutabilidade absoluta teria travado a própria verificação do sistema.

**Tarefa relacionada:** T09 (garantia de imutabilidade do log)

**Data:** 2026-09-08

---

## Nem todo dado malformado merece o mesmo tratamento: a origem do erro muda a decisão

**Contexto do problema:** o sistema recebe do balcão dois campos de texto que podem chegar errados, e a pergunta "recusar ou aceitar?" tem respostas opostas para eles. Um é o código do frasco, que a atendente digita quando a etiqueta está riscada, apagada ou molhada e a câmera não lê. O outro é um identificador de atendimento, gerado automaticamente pelo próprio aplicativo para agrupar as vendas de um mesmo cliente no relatório.

**Alternativas consideradas:** a resposta uniforme, que é o instinto de quem valida entrada — recusar tudo o que não bate com o formato esperado, antes de chegar à regra de negócio. É defensável e é o que a maioria dos frameworks facilita.

**Solução adotada:** tratamento assimétrico. Um código de frasco fora do padrão **é aceito**, segue para a consulta e volta como "código não cadastrado", com a leitura registrada no log. Um identificador de atendimento fora do padrão **é recusado** de imediato, e a requisição inteira é rejeitada.

**Por que resolve o problema / trade-offs:** o critério não é o formato, é a **origem** do dado. O código do frasco vem do mundo físico atravessando uma pessoa: quando ele chega torto, isso não é ruído, é o fenômeno que a pesquisa quer medir — quantas etiquetas ficaram ilegíveis nas condições reais da loja, com frascos curvos, plástico brilhante e a iluminação que existe. Recusá-lo por validação de formato apagaria do log exatamente a evidência que interessa, e o sistema ficaria mudo justamente sobre seu próprio ponto fraco. O identificador de atendimento, ao contrário, é gerado pelo software: se ele chega torto, o mundo físico não tem nada a ver com isso — é defeito do aplicativo, e aceitá-lo em silêncio produziria relatórios de agrupamento errados sem nenhum sinal de que algo quebrou. A generalização vale para qualquer sistema que substitua um processo manual e queira medir a substituição: dado que atravessa uma pessoa ou um objeto físico é observação e deve ser preservado mesmo quando "inválido"; dado que o próprio sistema fabrica é invariante e deve falhar alto quando quebra. Trade-off honesto: a assimetria custa uma explicação — dois campos vizinhos na mesma requisição com políticas opostas confundem quem lê o código pela primeira vez, e por isso ela está documentada nos dois lugares onde aparece.

**Tarefa relacionada:** T08 (código do frasco), T09 (identificador de atendimento)

**Data:** 2026-09-08

## Um sistema que substitui o controle manual não pode funcionar pela metade quando a rede cai

**Contexto do problema:** a tela de leitura é a única parte do sistema que a atendente usa
durante o atendimento, e ela roda num celular, dentro da loja, na rede que a loja tem. A
queda de conexão não é hipótese remota: é o cenário normal em ponto comercial pequeno. O
aplicativo é instalável e funciona como app, o que cria a expectativa — legítima — de que
ele continue servindo offline, como qualquer aplicativo de celular.

**Alternativas consideradas:** guardar as leituras feitas sem rede e enviá-las quando a
conexão voltar, que é a resposta padrão de qualquer aplicativo instalável e a que o próprio
formato sugere. Numa variante mais ousada, guardar também uma cópia local do estoque para
decidir na hora e sincronizar depois.

**Solução adotada:** não existe leitura offline. A tela verifica se há caminho até o
servidor antes de habilitar o fluxo de saída e, quando não há, bloqueia com uma mensagem
que diz por quê. O aplicativo instalado continua abrindo sem rede — mas para explicar o
bloqueio, não para operar. Como consequência do mesmo raciocínio, um veredito que ficou na
tela é descartado quando a conexão cai, em vez de reaparecer intacto quando ela volta.

**Por que resolve o problema / trade-offs:** a decisão parece uma limitação e é, na
verdade, o núcleo do argumento do trabalho. O que o sistema oferece à loja não é o registro
da venda — isso o caderno também fazia. É a resposta a uma pergunta que só pode ser
respondida olhando o estoque inteiro daquele produto **naquele instante**: qual destes
frascos sai primeiro. Uma leitura enfileirada para enviar depois entrega à atendente
exatamente o que ela já tinha antes do sistema: um palpite. Uma cópia local do estoque
entrega pior que isso, porque um palpite com aparência de veredito é mais perigoso que a
ausência de veredito — e no balcão a atendente age sobre o que a tela diz. O mesmo vale
para o veredito velho reaparecendo depois da reconexão: durante a queda, outra atendente
pode ter vendido a unidade apontada, e a tela estaria afirmando algo que ninguém
reconferiu. Vale registrar a assimetria que isso revela: o modo offline é aceitável para
funções que **acumulam** dado (registrar um recebimento, anotar uma contagem) e inaceitável
para funções que **decidem** sobre um recurso disputado. Um sistema que substitui processo
manual precisa dizer com todas as letras quais das suas funções são de qual tipo — e a
honestidade aqui custa: significa admitir que, sem rede, a loja volta ao processo manual
naquele atendimento. Trabalho futuro possível, se a conectividade da loja se mostrar um
problema real no piloto: permitir que a leitura offline registre a saída **sem** veredito
FIFO, marcada como não-validada, o que preservaria o dado da venda e deixaria explícito no
relatório quantas saídas escaparam da regra — em vez de fingir que foram validadas.

**Acréscimo de 2026-09-08 (T12), a partir da pergunta do orientando sobre manter uma cópia
do estoque no navegador:** vale nomear os dois desfechos concretos, porque o argumento
acima é abstrato e a proposta do cache local é intuitiva demais para ser descartada sem
eles. **(1) Beco sem saída:** a unidade mais antiga foi vendida há três minutos pela outra
atendente e o cache ainda a lista em estoque; a atendente lê a unidade que agora é a
correta e a tela manda buscar na prateleira um frasco que não está lá. É o mesmo laço sem
saída que o tratamento de empate evitou, recriado pelo cache. **(2) Venda dupla:** o cache
diz que pode vender uma unidade já vendida, o cliente sai com o produto, e a sincronização
descobre o conflito quando não há mais o que fazer — não existe estorno no sistema. O ponto
que generaliza é que o veredito não é uma leitura: desde a decisão de não ter confirmação
em dois passos, responder "pode vender" **é** dar a baixa, sob lock, e um cache pode
reproduzir a consulta mas não o ato. Um segundo detalhe fecha o argumento para o TCC: as
divergências entre um veredito local e o do servidor não seriam ruído aleatório — seriam
exatamente os casos de concorrência, que são o fenômeno que o sistema existe para tratar e
o que o indicador de acerto na primeira leitura mede.

**Tarefa relacionada:** T10 (tela de leitura, portão de offline), T12 (o acréscimo)

**Data:** 2026-09-08

---

## A biblioteca que não pode ser testada empurra a fronteira do que o teste automatizado garante

**Contexto do problema:** o gesto central do sistema é apontar a câmera do celular para o
código colado no frasco. Toda a lógica em volta — o que fazer com cada veredito, o laço de
tentar de novo, o agrupamento do atendimento, o bloqueio sem rede — é testável em ambiente
simulado. A câmera não é: ela depende de acesso ao hardware, de permissão do usuário, de
decodificação de imagem e de contexto seguro (HTTPS ou `localhost`), e nenhuma dessas
coisas existe no ambiente onde os testes automatizados rodam. A ferramenta de conferência
em navegador, usada no resto do projeto, também não resolve — ela dirige um navegador de
verdade, mas não aponta uma câmera física para um frasco de perfume.

**Alternativas consideradas:** aceitar a lacuna em silêncio, que é o desfecho comum — o
relatório de cobertura fica alto, a parte não coberta é pequena, e ninguém pergunta. Ou,
no extremo oposto, montar uma bancada de teste com câmera simulada alimentada por imagens,
custo desproporcional para um TCC.

**Solução adotada:** isolar a integração inteira com a biblioteca de câmera num único
componente que faz uma coisa só — pedir a câmera e emitir o texto que decodificar. Todo o
resto da tela é testado com esse componente substituído por um dublê. A lacuna fica, então,
com uma fronteira nítida e declarada: o que não está coberto por teste automatizado é
exatamente um arquivo, e a verificação que falta é uma só, em celular real.

**Por que resolve o problema / trade-offs:** o ganho não é de cobertura, é de **honestidade
sobre a cobertura**. Antes do isolamento, "a tela de leitura tem testes" seria uma
afirmação verdadeira e enganosa ao mesmo tempo. Depois, é possível dizer com precisão o que
os testes garantem (todos os vereditos, o laço, o agrupamento, o comportamento sem rede) e
o que eles não alcançam (a câmera abre? decodifica a etiqueta impressa? sob a luz da
loja?). Isso conecta com outra limitação já registrada neste projeto — a legibilidade
física do QR em frasco curvo e plástico brilhante —, e as duas se resolvem na mesma ida à
loja. A generalização que interessa ao artigo: num sistema que faz a ponte entre o mundo
físico e o digital, a fronteira do teste automatizado costuma cair exatamente na ponte. O
método de trabalho precisa prever esse ponto e nomear quem verifica o outro lado, em vez de
deixar a lacuna implícita no relatório de cobertura. Aqui isso virou item explícito de
verificação manual, com o motivo técnico anotado ao lado.

**Tarefa relacionada:** T10 (tela de leitura, componente de câmera isolado), T16 (RNF08,
legibilidade física do QR)

**Data:** 2026-09-08


---

## Três caminhos para o mesmo frasco: o sistema separa causas que o processo manual junta

**Contexto do problema:** no controle manual, quando a vendedora percebe no balcão que o
produto na mão dela está com a validade expirada, existe um gesto só — decidir na hora o
que fazer — e nenhum registro do que foi decidido. Três situações muito diferentes terminam
iguais para quem quiser entender a operação depois: (i) a data na etiqueta estava errada e
o produto está bom; (ii) o produto venceu mesmo e vai para o lixo; (iii) o produto venceu e
foi vendido assim mesmo. Nenhuma delas deixa rastro, e as três desaparecem na mesma frase:
"aconteceu de vez em quando". Quantificar perda é impossível quando a perda não se
distingue do erro de cadastro.

**Alternativas consideradas:** bloquear a venda de unidade vencida em definitivo, que é a
resposta técnica óbvia e a que menos se parece com a loja real — a decisão comercial existe
e continuaria acontecendo, só que fora do sistema, o que é o pior dos mundos para a
pesquisa. Ou tratar a unidade vencida como um erro de leitura qualquer, devolvendo a
atendente ao ponto de partida sem resolver nada — foi o estado do sistema entre T07 e esta
tarefa.

**Solução adotada:** ao detectar unidade vencida, o sistema para o fluxo de saída e oferece
três caminhos explícitos, cada um com efeito próprio e evento próprio no log imutável:
corrigir a validade (e revalidar o FIFO do zero, porque a data corrigida reordena a fila do
SKU), dar baixa por descarte, ou autorizar a venda com justificativa obrigatória e restrita
ao gestor. A pessoa continua decidindo — o sistema não decide por ela —, mas cada decisão
passa a ter nome, autor e horário.

**Por que resolve o problema / trade-offs:** o mesmo gesto de antes agora produz três dados
distinguíveis, e é essa distinção que torna a perda mensurável: descarte é perda, correção
é qualidade de cadastro, override é decisão comercial. Um indicador que some os três diria
muito pouco. O custo é fricção real no balcão — a atendente precisa escolher, e no caminho
do override precisa chamar quem tem o papel de gestor. A escolha de projeto foi distribuir
essa fricção de forma desigual: descartar é o caminho fácil (nem motivo é obrigatório),
porque é o que produz o dado que a pesquisa quer; autorizar é o caminho difícil. Fricção
não é efeito colateral do sistema, é instrumento de projeto — e onde ela é colocada
determina qual dado se consegue coletar.

**Tarefa relacionada:** T11

**Data:** 2026-09-08

---

## Uma exceção pode virar contorno de outra regra sem que ninguém tenha decidido isso

**Contexto do problema:** o sistema tem dois bloqueios distintos, e eles se parecem
bastante de dentro do código: o FIFO impede vender a unidade errada, e a validade impede
vender a unidade vencida. O PRD prevê um escape para o segundo — a venda de unidade vencida
mediante autorização registrada. Não prevê escape nenhum para o primeiro, e não poderia: o
bloqueio FIFO é o objeto do trabalho.

**Alternativas consideradas:** implementar o endpoint de autorização como ele se descreve
em linguagem natural — "cria uma saída com justificativa, marcada como venda de unidade
vencida". Essa leitura é fiel ao texto e produz um defeito grave: como o endpoint não passa
pela validação de FIFO (e não deve passar, porque a unidade vencida está fora da fila por
definição), ele aceitaria **qualquer** unidade em estoque. Um gestor com pressa teria, sem
querer, um botão de "vender fora de ordem com justificativa" — e o bloqueio reativo, que é
a contribuição central do sistema, viraria opcional para quem tem o papel.

**Solução adotada:** o endpoint recusa unidade que não esteja vencida, com erro próprio, e
essa recusa é conferida sob o mesmo lock das demais. O escape vale para um bloqueio só. O
teste que prova isso não descreve um formulário inválido; ele monta o cenário do desvio —
duas unidades válidas, a mais antiga em estoque — e verifica que a tentativa de autorizar a
mais nova é recusada.

**Por que resolve o problema / trade-offs:** a descoberta que interessa ao artigo é sobre
escrita de requisito, não sobre código. A especificação da exceção estava completa quanto
ao que ela **permite** e silenciosa quanto ao que ela **não** permite — e é justamente esse
silêncio que uma implementação fiel converte em brecha. Num sistema cuja função é impor uma
regra, cada mecanismo de exceção precisa declarar a qual regra ele se aplica; caso
contrário ele se aplica a todas. O custo aqui é nenhum: o caminho legítimo continua
funcionando igual. O custo estaria na versão sem a trava, e seria invisível até alguém
analisar por que o indicador de acerto na primeira leitura melhorou tanto.

**Tarefa relacionada:** T11 (a trava), T07 (o bloqueio que ela protege)

**Data:** 2026-09-08

---

## O que o sistema ainda não sabe fazer com um frasco: avaria, quebra e furto

**Contexto do problema:** a perfumaria perde produto por mais de um motivo. O vencimento é
o que este trabalho ataca, mas o frasco que cai e quebra, o item avariado no transporte e o
furto também tiram unidades da prateleira — e, hoje, tiram do estoque físico sem tirar do
estoque do sistema.

**Solução adotada:** nenhuma, deliberadamente. A baixa por descarte só aceita unidade
vencida; qualquer outra é recusada. Isso mantém o dado de perda limpo — todo `Descarte` no
banco é perda por validade, sem necessidade de filtrar por motivo escrito à mão — e mantém
o escopo da tarefa dentro do que o PRD especifica.

**Por que resolve o problema / trade-offs:** é uma limitação a declarar no artigo, não um
esquecimento. Na loja real, a unidade quebrada vai continuar aparecendo como
`EM_ESTOQUE` até alguém tropeçar nela numa leitura de QR, e o total de unidades em estoque
do painel será otimista nessa medida. O trabalho futuro é uma baixa por motivo genérico,
separada da baixa por validade — separada justamente para que o indicador de perda por
vencimento continue significando uma coisa só. Junta-se aqui outra limitação já registrada:
a venda é irreversível no sistema, inclusive a autorizada por override, porque não há
estorno.

**Tarefa relacionada:** T11 (o que ficou de fora), T13 (fila de descarte pendente)

**Data:** 2026-09-08

---

## Onde termina a ergonomia do formulário e começa a regra de negócio

**Contexto do problema:** um sistema cuja contribuição é *manter a regra num lugar só*
(RNF03) enfrenta uma pergunta prática toda vez que constrói uma tela: o que a interface
pode conferir antes de perguntar ao servidor? Recusar tudo no cliente reimplanta a regra em
dois lugares — o defeito que o trabalho quer evitar. Não conferir nada produz interfaces
que só sabem dizer "não" depois de uma ida à rede, e às vezes com a linguagem errada.

**Alternativas consideradas:** a regra rígida de "o cliente não valida nada" foi a primeira
proposta desta tarefa. Ela não sobreviveu a dois fatos. O primeiro é que o projeto já
espelhava restrições de formulário em telas anteriores (limites numéricos de quantidade
vindos do schema do backend), então a regra teria criado uma exceção sem justificar por quê.
O segundo é que, sem espelho, a recusa do servidor chegava à tela como mensagem interna do
framework em inglês — no fluxo mais delicado do sistema, a autorização de venda de produto
vencido.

**Solução adotada:** o critério que separa os dois casos não é "é regra de negócio?", que
não se responde no caso concreto, e sim **de quem é o dado**. A tela pode antecipar o que
ela mesma possui por inteiro — o texto que a pessoa acabou de digitar, cujo comprimento não
envelhece e não depende de mais ninguém. Não pode antecipar o que é **cópia de estado do
servidor** — a validade gravada da unidade, o status dela, a ordem do pool FIFO. Na prática
desta tela: o mínimo de caracteres da justificativa é espelhado (botão desabilitado,
contagem à vista, nenhuma ida à rede); a recusa de "validade igual à cadastrada" não é, e
chega do servidor, sob lock.

**Por que resolve o problema / trade-offs:** o critério é mais barato de aplicar que a
distinção abstrata entre validação e regra, e erra para o lado seguro. Uma antecipação
errada do primeiro tipo é impossível: o texto está ali. Uma antecipação errada do segundo
tipo é silenciosa e cara — se outra pessoa corrigiu aquela unidade enquanto o frasco estava
na mão, a tela bloquearia uma correção legítima afirmando que não há o que corrigir, e
ninguém descobriria o motivo. O trade-off aceito é uma ida à rede para descobrir que uma
data não mudou, num evento raro, dentro de um fluxo que já fez outras. Para o artigo,
interessa que a coesão da regra não exige uma interface muda: exige saber qual pergunta é
sobre o usuário e qual é sobre o mundo compartilhado.

**Tarefa relacionada:** T12 (a tela da exceção), T11 (as recusas que ela exibe), RNF03/RNF04

**Data:** 2026-09-08

---

## O padrão do framework é uma decisão de projeto que ninguém tomou

**Contexto do problema:** um sistema que substitui controle manual é usado por quem não
escreveu o software e não tem a quem perguntar no meio de um atendimento. Toda mensagem que
chega ao balcão é interface, inclusive as que o desenvolvedor nunca redigiu. No estado
anterior a esta tarefa, uma justificativa curta demais no fluxo de venda de produto vencido
— o mais delicado do sistema — produzia na tela `body/justificativa must NOT have fewer
than 10 characters`: o texto interno do validador, em inglês, citando o caminho do campo no
corpo da requisição HTTP. Nenhuma linha de código do projeto pedia isso; era o padrão do
framework aparecendo onde ninguém olhou.

**Alternativas consideradas:** traduzir cada regra do validador para português (mínimo,
máximo, formato, tipo, aninhamento) daria a melhor mensagem possível, mas produziria uma
segunda declaração das restrições que o schema já declara — duas cópias da mesma regra para
manter em sincronia, exatamente o defeito que a RNF03 combate no núcleo do sistema. Citar o
nome do campo na mensagem exibida ("Confira: justificativa") custa pouco, mas expõe o
identificador técnico do JSON, que nem sempre é o rótulo que a pessoa vê no formulário.

**Solução adotada:** um tratador único, na montagem da aplicação, que converte tudo que o
framework gera para o mesmo formato `{ erro, mensagem }` das recusas escritas à mão — com
uma mensagem genérica honesta e os campos recusados num array separado, para diagnóstico.
As recusas de negócio continuam redigidas nas rotas, caso a caso, e não passam pelo
tratador: "esta unidade não está vencida" explica o que nenhuma mensagem genérica
explicaria. A camada genérica é a rede embaixo, não o substituto da mensagem específica.

**Por que resolve o problema / trade-offs:** o achado que interessa ao artigo é que o
vazamento maior não era o de linguagem, e sim o de conteúdo. Sem tratador, uma exceção não
prevista devolve ao navegador a mensagem original do ORM — nome de tabela, nome de coluna
e, na violação de unicidade, o próprio valor que colidiu. Num sistema que registra quem
autorizou a venda de produto vencido e com qual justificativa (RNF09/LGPD), isso é dado de
negócio saindo pela porta do erro. O mesmo tratador que traduz a recusa de formulário fecha
esse vazamento, e a segunda metade é a que tem consequência jurídica. Fica a limitação a
declarar com honestidade: o validador do framework para na primeira falha e remove campos
desconhecidos em vez de recusá-los, então a lista de campos devolvida é pista de
diagnóstico, não relatório completo do formulário — quem orienta o usuário continua sendo a
tela, não a resposta de erro.

**Tarefa relacionada:** T12b (o tratador), T12 (onde o defeito apareceu), RNF04, RNF09

**Data:** 2026-09-08

---

## A perda que ninguém encontra: o limbo entre o bloqueio do FIFO e o relatório de perdas

**Contexto do problema:** o controle manual descobre a unidade vencida por acaso — alguém
esbarra nela ao procurar outra coisa, ou o cliente pede justamente aquele frasco. A versão
automatizada do mesmo problema é sutil e foi encontrada durante a implementação: ao excluir
as unidades vencidas do pool de candidatas prioritárias (exigência do PRD, sem a qual o
sistema empurraria produto vencido para o cliente), o software cria um estado em que a
unidade não sai pelo fluxo de venda **e** não aparece em nenhum relatório de perda, porque
perda só existe depois do descarte registrado. Ela continua contada como estoque, ocupando
prateleira, sem nunca ser oferecida a ninguém. A regra que protege o cliente é a mesma que
esconde a unidade — e o sistema, sozinho, não tinha caminho para reencontrá-la.

**Alternativas consideradas:** descartar automaticamente o que vence, o que transformaria em
baixa contábil silenciosa um ato que a loja precisa executar fisicamente (alguém tem de
retirar o frasco da prateleira) e destruiria a distinção entre "venceu" e "foi constatado
vencido". Ou tratar a unidade vencida como prioritária na leitura seguinte, que é exatamente
o que o PRD proíbe. Ou esperar o alerta de vencimento próximo (requisito de outro
incremento) resolver o caso: não resolve — o alerta fala do que **vai** vencer, e nada
recolhe o que já venceu antes de o alerta existir ou apesar dele.

**Solução adotada:** uma listagem ativa no painel do gestor, cuja condição é a negação exata
do filtro que o motor de FIFO usa para excluir vencidas do pool, avaliada contra a mesma
noção de "hoje". As duas cláusulas são complementares por construção: toda unidade em
estoque está de um lado ou do outro. Resolver a partir da lista reusa os mesmos três
caminhos da exceção de balcão, sem uma segunda implementação — com uma exclusão deliberada,
descrita abaixo.

**Por que resolve o problema / trade-offs:** o achado que interessa ao artigo é que a
descoberta passiva e a descoberta ativa produzem **dados diferentes sobre a mesma perda**, e
o registro precisa saber distinguir uma da outra. Um descarte vindo do balcão carrega a
leitura de QR que o antecedeu e o agrupador do atendimento; um descarte vindo da varredura
não tem nenhum dos dois, e é essa ausência que identifica sua origem — sem campo novo,
sem sinalizador inventado. A distinção importa para a variável dependente da pesquisa: a
perda encontrada por varredura mede o estoque parado, e a encontrada no balcão mede o
quanto o controle manual deixaria passar até o cliente. Somá-las sem distinguir subestima
uma e superestima a outra. Fica também uma limitação a declarar: a fila mostra o que já
venceu, e depende de o gestor abri-la — o sistema torna a perda **encontrável**, não
inevitável de encontrar.

**Uma restrição de design não se transporta sozinha de um contexto para outro.** O override
de venda de unidade vencida foi deixado fora da fila, embora seja tecnicamente o mesmo
endpoint e o mesmo papel. Ele é escape do balcão, com cliente à frente, e é o cliente
presente que dá sentido à fricção que o PRD exige. Oferecido numa varredura de estoque, o
mesmo botão viraria uma forma de dar baixa em lote como "venda autorizada" de coisas que
ninguém comprou — o registro permanente de um ato que não aconteceu. Vale ao artigo porque
o PRD não previa este segundo contexto: a restrição precisou ser reinterpretada, não
copiada.

**Tarefa relacionada:** T13 (a fila), T07 (a exclusão do pool que cria o limbo), T11 (os
três caminhos reusados), RF11/RF12

**Data:** 2026-09-08

---

## O identificador cabe exatamente no menor símbolo com a maior proteção — e isso não foi sorte gerenciada

**Contexto do problema:** o controle manual identifica o produto pelo que já vem impresso na
embalagem — o código de barras do fabricante, quando existe, ou nada. Nenhum dos dois
identifica a **unidade física**, que é o nível em que o problema da validade acontece: dois
frascos idênticos do mesmo SKU, validades diferentes, indistinguíveis na prateleira. A
solução por unidade exige colar em cada frasco uma etiqueta nova, e é aí que o mundo físico
impõe sua condição: a etiqueta precisa caber numa embalagem pequena, muitas vezes curva e
brilhante, e continuar legível depois de manuseio, atrito e gordura de mão.

**Alternativas consideradas:** codificar no QR uma URL apontando para o sistema, que é o
padrão da indústria e permitiria ler a etiqueta com qualquer aplicativo de câmera. E usar um
nível de correção de erro intermediário, que é o padrão das bibliotecas.

**Solução adotada:** o símbolo carrega o código puro (10 caracteres) e usa o nível de
correção de erro **mais alto** que a norma do QR oferece. As duas escolhas se sustentam numa
coincidência aritmética que só apareceu ao implementar: um QR da menor versão possível
(21×21 módulos) comporta, em modo alfanumérico e correção máxima, **exatamente 10
caracteres** — que é o comprimento do identificador escolhido em outra tarefa, por outro
motivo (evitar caracteres que se confundem quando alguém digita o código à mão).

**Por que resolve o problema / trade-offs:** o resultado é que a etiqueta usa a proteção
máxima contra dano físico — cerca de 30% do símbolo pode ser recuperado — **sem pagar um
único módulo a mais de tamanho**. Numa embalagem pequena, tamanho de símbolo e robustez são
normalmente um trade-off direto: mais dados ou mais redundância significam mais módulos no
mesmo espaço, cada um menor, e módulo pequeno é o que a câmera erra num frasco curvo. Aqui
os dois lados ganharam ao mesmo tempo, e a razão é que o dado codificado é curto — o que só
foi possível porque a etiqueta aponta para um identificador **interno** em vez de carregar
uma URL. A escolha de não codificar URL tem um custo real e declarado: a etiqueta não é
legível por aplicativos genéricos de câmera, só pelo sistema. Em troca, ela não fica
amarrada a um endereço de implantação — trocar o domínio do sistema inutilizaria o estoque
inteiro já etiquetado, que é um risco desproporcional para uma loja que colou etiqueta em
centenas de frascos.

O ponto generalizável para o artigo: **restrições que parecem de camadas independentes
podem estar acopladas por aritmética, e o acoplamento só aparece na implementação.** O
formato do identificador foi decidido pensando em quem digita, não em quem imprime; a
decisão de impressão herdou dele uma folga que ninguém planejou. Vale registrar também a
direção contrária, que é a parte incômoda: a folga acabou. O identificador agora está
travado em 10 caracteres — um a mais derruba o símbolo para a versão seguinte, mais denso —
e essa restrição nasceu depois de a validação física da etiqueta já estar planejada, e antes
de ela ter sido feita. Uma decisão tomada cedo, por um motivo, tornou-se cara de revisar por
outro.

**Tarefa relacionada:** T14 (o símbolo), T05 (o formato do identificador), T16/RNF08 (a
validação física que ainda pode reabrir os dois)

**Data:** 2026-09-08

---

## O que o sistema deliberadamente não sabe: quantas etiquetas foram reimpressas

**Contexto do problema:** a etiqueta é o elo mais frágil da solução por unidade física. Ela
se solta, borra, é coberta pelo dedo de quem segura o frasco, ou simplesmente não lê sob a
luz da loja. Cada uma dessas falhas empurra a atendente para o fallback de digitação manual
— e, se a etiqueta se perdeu de vez, para a reimpressão.

**Alternativas consideradas:** gravar um evento a cada geração de etiqueta, o que permitiria
contar reimpressões e usar esse número como indicador indireto de fragilidade física da
solução.

**Solução adotada:** não gravar. A geração de etiquetas é uma consulta, e consultas não
escrevem no registro de eventos — a mesma regra aplicada à fila de descarte pendente.

**Por que resolve o problema / trade-offs:** é uma limitação a declarar honestamente, não
uma virtude. A contagem de reimpressões seria um dado bom para a pesquisa: ela mede
exatamente o que o requisito de legibilidade física teme, e mediria em operação real, com o
frasco na prateleira e a luz que a loja tem — coisa que um teste de legibilidade feito uma
vez, em condições controladas, não alcança. O sistema, como está, é mudo sobre a própria
fragilidade: ele registra a leitura que falhou (a digitação manual fica no log como leitura
de código não encontrado, decisão de outra tarefa), mas não registra a etiqueta que precisou
ser refeita. Medir isso exigiria uma ação explícita de "reimprimir", distinta de "imprimir
pela primeira vez" — o sistema não sabe qual das duas está acontecendo, porque não sabe o
que já foi impresso. É trabalho futuro, e o artigo deve dizer isso em vez de apresentar a
solução como instrumentada de ponta a ponta.

**Tarefa relacionada:** T14 (a geração sem evento), T16/RNF08 (a validação física que este
dado complementaria), RF12

**Data:** 2026-09-08

## A implementação de referência só é reproduzível pela metade — e a metade que sobra apodrece em silêncio

**Contexto do problema:** um artigo que apresenta uma implementação de referência carrega
uma promessa implícita: quem lê consegue rodar. Este projeto tentou honrá-la por
organização — até T05, as 66 asserções rodavam com o acesso ao banco substituído por um
duplo, e a suíte inteira executava em qualquer máquina com Node instalado. T06 quebrou isso
por necessidade, e a quebra é do tipo que não tem contorno: as duas garantias centrais da
solução — o lock que serializa duas vendas simultâneas do mesmo frasco (RNF02) e a
comparação de validade como data de calendário, sem hora (RNF01) — **são comportamentos do
banco**, não do código. Um duplo que as "reproduzisse" estaria devolvendo a resposta que o
teste deveria estar verificando. A partir dali, provar o núcleo passou a exigir PostgreSQL
de verdade.

**Alternativas consideradas:** abandonar a execução sem banco e assumir o container como
pré-requisito único seria honesto e mais simples, mas fecha a porta para quem quer só
inspecionar o projeto — inclusive a banca. Manter tudo com duplo era a opção descartada em
T06, pelo motivo acima. O caminho escolhido foi intermediário: um segundo comando que roda
só o que não depende do banco, preservando uma execução parcial em qualquer máquina.

**Solução adotada:** o comando existe desde T06 e funciona — mas foi implementado como uma
**lista de exclusões**, uma linha por suíte de banco, que alguém precisava lembrar de
editar a cada suíte nova. Em cinco oportunidades a memória falhou uma vez: a suíte da fila
de descarte entrou sem que a linha fosse atualizada, e por duas tarefas o comando que
promete rodar sem banco **falhava sem banco** — defeito invisível para quem tem o container
ligado, que é justamente todo mundo que trabalha no projeto. A correção trocou a lista por
uma regra derivada de uma convenção que as suítes já seguiam sem ninguém ter escrito: suíte
de banco mora em subpasta, suíte sem banco é arquivo solto.

**Por que resolve o problema / trade-offs:** o ponto que interessa ao artigo não é o
defeito de uma linha, e sim o que ele mostra sobre garantias de reprodutibilidade em geral —
**elas se degradam sem emitir sinal para quem poderia corrigi-las.** Quem tinha como
perceber (o desenvolvedor) nunca estava na condição que revelava o problema (máquina sem
banco), e quem estaria nessa condição (o leitor, a banca) não teria como distinguir um
script quebrado de um projeto quebrado. A regra por pasta reduz a manutenção a zero, mas a
troca é explícita e vale declarar: o erro deixou de ser barulhento e passou a ser silencioso —
uma suíte sem banco criada no lugar errado seria pulada sem aviso, em vez de derrubar o
comando. Trocou-se um erro provável e visível por um erro improvável e invisível.

A limitação honesta que fica para o texto: **138 das 227 asserções deste projeto não rodam
sem um PostgreSQL**, e são precisamente as que provam o comportamento defendido no artigo.
As 89 restantes cobrem contratos de rota e formato de identificador. Dizer "a suíte passa"
sem dizer qual metade prova o quê seria vender uma reprodutibilidade que a natureza do
problema não permite — a regra de FIFO por validade é, em boa parte, uma afirmação sobre o
que o banco de dados garante sob concorrência.

**Tarefa relacionada:** T14b (a correção), T06 (onde a garantia foi criada), T13 (onde ela
se perdeu), T14 (onde o defeito foi encontrado), RNF01, RNF02

**Data:** 2026-09-08

---

## O custo operacional do controle por unidade é medido em milímetros de embalagem

**Contexto do problema:** a decisão fundadora deste trabalho — identificar a **unidade
física**, e não o lote — foi tomada na primeira nota deste arquivo, e o custo dela ficou
registrado ali em uma frase: "cada unidade individual precisa ser fisicamente etiquetada".
T15 é onde essa frase vira problema concreto, e ele não é de software. Uma perfumaria vende
frascos de 30 ml, batons, amostras: superfícies pequenas, curvas e brilhantes, quase sempre
já ocupadas pelo rótulo do fabricante. O espaço disponível para a etiqueta do sistema é o que
sobra — e o símbolo QR precisa caber nesse resto **e** continuar legível por uma câmera de
celular sob a luz da loja.

**Alternativas consideradas:** fixar um tamanho de etiqueta no código, escolhido pela
referência técnica (algo em torno de 0,5 mm por módulo para impressora comum), e tratar o
assunto como resolvido. Era o caminho natural, e é o que a maioria das implementações faz.
Foi descartado por contradizer o que a própria RNF08 exige: validar a leitura em superfície
real **antes** de congelar o formato. Um valor fixo no código transforma cada tentativa de
validação física numa alteração de software.

**Solução adotada:** a folha de impressão oferece três tamanhos de símbolo (15, 20 e 25 mm de
lado, que dão módulos de ~0,52, ~0,69 e ~0,86 mm), e **imprime no rodapé qual tamanho gerou
aquela folha**. O que sai no papel ao lado do símbolo foi reduzido ao mínimo defensável:
o código em texto, porque a digitação manual é o fallback quando a câmera falha, e a data de
validade, porque é o que um humano precisa ver na prateleira sem escanear nada. O nome do
produto ficou de fora — já está impresso no frasco pelo fabricante, e ali ele disputaria
espaço com o símbolo.

**Por que resolve o problema / trade-offs:** o ponto que interessa ao artigo é que a
granularidade por unidade **empurra uma parte da solução para fora do software**. O sistema
pode provar que o símbolo é um QR válido de versão 1 nível H (T14 provou, relendo a matriz de
módulos do próprio SVG entregue), e não pode provar que ele é legível colado num frasco
curvo. Essa fronteira não é uma limitação de implementação a ser superada com mais código: é
a natureza do problema. A solução adotada não tenta atravessá-la — instrumenta a travessia,
entregando uma folha de teste que já sai identificada pelo tamanho, para que a validação
física (RNF08) produza um resultado que se possa citar: "15 mm falhou em frasco curvo, 20 mm
passou".

O trade-off assumido: enquanto essa validação não acontece, **o sistema tem três respostas
possíveis para uma pergunta que deveria ter uma**. Um artigo honesto precisa dizer que o
tamanho da etiqueta ainda não está decidido, e que a decisão depende de um teste com régua,
tesoura e o celular da loja — não de mais uma iteração de desenvolvimento. Some-se a isso que
a impressão sai pelo diálogo do navegador em papel comum, sem impressora de etiquetas
dedicada, o que introduz variação de fidelidade entre navegadores e configurações de margem
que só a medição física resolve.

**Tarefa relacionada:** T15, T16/RNF08 (a validação que decide), T14 (o símbolo), T05 (o
formato do código), RF04

**Data:** 2026-09-08

---

## O parâmetro que muda o significado do dado sem deixar rastro

**Contexto do problema:** todo o sistema construído até aqui é reativo. O bloqueio de FIFO
age quando alguém lê um QR no balcão; a fila de descarte mostra a perda já consumada. Entre
"o frasco está no estoque" e "o frasco venceu" existe uma janela em que ainda cabe decisão
comercial — promoção, destaque na vitrine —, e é dela que a RF08 trata. O ponto interessante
não é a janela em si, e sim que **o seu tamanho é um parâmetro que a loja define**. Trinta
dias é razoável para um perfume e absurdo para um item de giro rápido; nenhum número
escolhido no código serve para as duas coisas.

**Alternativas consideradas:** fixar a antecedência no código (30 dias, o exemplo do próprio
PRD) e tratar o assunto como resolvido. Seria mais simples e tornaria o dado da pesquisa
trivialmente comparável — a janela seria a mesma o piloto inteiro, por construção. Foi
descartado porque a RF08 pede explicitamente "janela definida pelo usuário", e porque um
número fixo transformaria cada ajuste da loja numa alteração de software. O oposto —
configuração por SKU ou por categoria — foi descartado por não estar no PRD e por multiplicar
o problema descrito abaixo.

**Solução adotada:** uma coleção de janelas configuráveis pelo gestor (antecedência em dias e
canal de entrega), com inativação em vez de exclusão, para que um alerta já emitido continue
apontando para a configuração sob a qual foi emitido. Duas janelas ativas com a mesma
antecedência são recusadas, porque gerariam dois alertas para a mesma unidade no mesmo dia e
inflariam a contagem de alertas emitidos que a RF13 vai reportar.

**Por que resolve o problema / trade-offs:** o que interessa ao artigo é uma limitação que
apareceu ao decidir o que **não** registrar. Os tipos de evento do `EventoLog` são uma lista
fechada, e a razão de serem fechados é metodológica: acrescentar um tipo depois que o piloto
começa quebra a comparabilidade entre os dados coletados antes e depois. Nenhum dos nove
tipos descreve mudança de configuração, e nenhum foi acrescentado. A consequência é que **o
sistema não sabe quando a janela de antecedência foi alterada, nem qual era antes**.

Isso é diferente das outras coisas que o sistema deliberadamente não registra (quantas
etiquetas foram reimpressas, por exemplo), porque aqui o dado não registrado **muda o
significado dos dados que são registrados**. Se a gestora trocar 30 por 7 no meio do piloto,
a série de alertas emitidos passa a misturar dois regimes, e a análise não tem como
perceber: verá uma queda no número de alertas e poderá atribuí-la a melhora do estoque, quando
a causa foi a mudança de um parâmetro. É uma variável independente que o experimento permite
alterar sem instrumentar.

Registrar isso honestamente vale mais do que corrigir por reflexo: a correção — um décimo
tipo de evento — tem custo próprio, porque mexe justamente na lista que o desenho protege.
Para o piloto, a mitigação é procedimental: anotar fora do sistema qualquer alteração da
janela, com data. Para trabalho futuro, a alternativa é versionar a configuração em vez de
alterá-la no lugar, o que daria à análise a fronteira exata entre um regime e o outro. A
observação mais geral, e a que cabe no artigo: **em um sistema que também é instrumento de
coleta, um parâmetro configurável é uma variável do experimento**, e o desenho precisa
decidir explicitamente se ela vai ser observada ou congelada — decidir por omissão é o que
produz a série ambígua.

**Tarefa relacionada:** T17, T18/T19 (que consomem a configuração), RF08, RF12/RF13

**Data:** 2026-09-08

---

## O primeiro ato que o sistema pratica sozinho — e o que ele exige que o processo manual nunca precisou ter

**Contexto do problema:** tudo o que este sistema fazia até aqui era reativo, e nisso ele
ainda se parecia com o processo manual que veio substituir. O FIFO decide quando uma
atendente lê um QR; a fila de descarte mostra o que já virou perda. Na loja, é o mesmo
desenho: alguém olha a prateleira e repara — ou não repara. A perda por vencimento não
acontece por falta de regra, acontece porque **ninguém estava olhando naquele intervalo**, e
a janela em que ainda cabia uma decisão comercial (promoção, destaque na vitrine) passou sem
ser vista. A jornada J3 do PRD pede exatamente o contrário: verificação periódica, alerta,
decisão antes da perda.

**Alternativas consideradas:** para o disparo, `cron` do sistema operacional, uma rota HTTP
"rodar agora" e um agendador dentro do processo do backend. Para a repetição do alerta, um
lembrete recorrente enquanto a unidade continuasse parada, ou uma notícia única de entrada na
janela.

**Solução adotada:** uma varredura idempotente, agendada por intervalo dentro do próprio
processo do servidor. Para cada janela de antecedência ativa, ela materializa um `Alerta` por
unidade que entrou naquela janela — uma vez, garantido por índice único no banco — e um
evento `ALERTA_PROATIVO_EMITIDO` por alerta. O que já venceu fica de fora: é da fila de
descarte, e a decisão comercial já não cabe mais.

**Por que resolve o problema / trade-offs:** o achado que vale ao artigo é o que a
automação **exigiu** e que o processo manual nunca precisou ter. Três coisas apareceram, e
nenhuma delas estava no PRD:

1. **Um ator não-humano.** Todo registro do sistema até aqui tinha autor: quem leu o QR, quem
   cadastrou o lote, quem autorizou a venda vencida. O log é instrumento de coleta do TCC, e
   sua chave de usuário é obrigatória justamente porque a pesquisa quer saber quem fez o quê.
   A varredura não tem quem: ninguém pediu, ninguém clicou. Foi preciso criar uma conta de
   sistema para assinar o evento — e, com ela, a obrigação de a análise **excluí-la ao contar
   ações humanas**, sob pena de o piloto reportar uma atendente fictícia como a mais ativa da
   loja. É um custo metodológico que só aparece quando o software deixa de ser mero registro
   do que as pessoas fazem e passa a agir.
2. **Idempotência como requisito, não como refinamento.** No processo manual, "avisar de
   novo" é decisão de quem avisa. Automatizado, o mesmo estoque é reexaminado indefinidamente,
   e a pergunta "já avisei sobre este frasco?" precisou de resposta persistida antes de o
   primeiro alerta existir. A escolha — o alerta é a notícia da *entrada* na janela, não um
   lembrete — é o que permitiu o agendamento ser simples (intervalo tosco, sem estado de
   última execução, sobrevivendo a reinício). O trade-off é assumido: uma unidade que
   continua parada não volta a incomodar ninguém pela mesma janela. Uma janela mais estreita
   configurada em paralelo (7 dias, "última chamada") é a forma prevista de insistir, e ela
   insiste com informação nova, não repetindo a antiga.
3. **Uma dependência operacional que não existia.** O agendador vive no processo do backend.
   **Se o servidor estiver fora do ar na hora, aquela passagem não acontece** — e, como o
   alerta é a notícia de uma entrada e não um estado recalculado, uma passagem perdida não é
   recuperada com atraso, é diluída na seguinte (que ainda alerta, porque a unidade continua
   na janela; o que se perde são horas, não o alerta). A janela ter dias de folga é o que
   torna isso tolerável nesta escala. Num sistema maior a resposta seria outra — agendador
   externo, com registro de execuções —, e essa é a fronteira honesta a declarar: **a
   automação proativa transfere para a disponibilidade do software uma vigilância que antes
   dependia da presença de uma pessoa**. Quando ninguém está olhando, o sistema é o único que
   está; se ele também não estiver, ninguém está.

Há ainda uma limitação de escopo a declarar sem rodeios: esta tarefa **emite** o alerta e não
o entrega a ninguém. Entre ela e a entrega (in-app e push), o alerta existe no banco e não
muda o comportamento de ninguém na loja — é registro, não aviso. O valor medido pelo piloto
só começa a existir quando a notificação chega.

**Tarefa relacionada:** T18 (a varredura), T17 (a janela que ela lê), T19 (a entrega), T13
(a fila do que já venceu, que é a fronteira inferior da janela), RF08, RF12/RF13

**Data:** 2026-09-09

---

## O aviso que ninguém leu: quando a automação da vigilância termina em um ato humano

**Contexto do problema:** o processo manual da perfumaria não tinha um "alerta" — tinha uma
pessoa olhando a prateleira. Nesse desenho, avisar e reconhecer o aviso são o mesmo ato: quem
vê o frasco perto de vencer já está diante dele, com a decisão na mão. Automatizar a
vigilância (T18) separou as duas coisas pela primeira vez, e a separação criou um estado que
antes não existia: o **aviso emitido e não reconhecido**. É o que esta tarefa entrega, e o
que ela revela sobre o problema vale mais que a tela em si.

**Três coisas apareceram ao implementar a entrega:**

1. **A cadeia da RF08 tem um elo humano que o software não alcança.** O sistema configura a
   janela, varre o estoque, emite o alerta e o exibe — e para. A ação que o alerta pede
   (promoção, destaque na vitrine, ligar para um cliente) acontece **fora** do sistema, e por
   isso o software não pode medir se ela aconteceu: só sabe se a unidade foi vendida ou se
   venceu. O `ALERTA_LIDO` é o mais longe que a instrumentação chega — ele registra que
   alguém *viu*, não que alguém *agiu*. A distância entre ver e agir é exatamente o que o
   piloto vai ter de observar por entrevista, e não por log. Numa loja onde a gestora não
   abre o sistema, a cadeia inteira produz zero efeito: **a automação da vigilância não
   automatiza a resposta**, e o gargalo apenas se desloca do "reparar" para o "abrir a tela".
2. **Um aviso que falhou precisa continuar visível, e isso contraria a regra que o resto do
   sistema segue.** Todo o desenho até aqui evita mostrar o mesmo fato em dois lugares — a
   fila de descarte de T13 é a negação exata do pool do FIFO justamente por isso, e T18
   recusou emitir alerta sobre unidade já vencida pelo mesmo motivo. Aqui a decisão foi a
   oposta, deliberadamente: o alerta cuja unidade **venceu depois de emitido** continua na
   lista, marcado, e a mesma unidade aparece também na fila de descarte. A razão é que os
   dois lugares dizem coisas diferentes — a fila diz "resolva este frasco"; o alerta vencido
   diz "você foi avisado e ele venceu assim mesmo". Omiti-lo deixaria a tela mais limpa e
   apagaria justamente o caso que mede se a RF08 funciona. **O indicador de fracasso de um
   alerta é o próprio alerta que sobrou**, e um sistema que arruma a tela apagando os avisos
   que não deram certo reporta apenas os seus acertos.
3. **Reconhecer o aviso custou o décimo tipo de evento — o primeiro fora da lista do PRD.** A
   lista dos nove tipos era fechada desde o início, com uma razão explícita: acrescentar um
   depois do piloto começado quebra a comparabilidade entre o antes e o depois. `ALERTA_LIDO`
   foi acrescentado **antes** do piloto, conscientemente, porque o par
   `ALERTA_PROATIVO_EMITIDO` → `ALERTA_LIDO` da mesma unidade responde uma pergunta que
   nenhuma outra fonte responde: **quanto tempo a loja leva para reagir a um aviso**. É um
   indicador de processo, não de estoque, e não existe no controle manual — lá, o intervalo
   entre notar e decidir não deixa rastro nenhum.

**Limitações a declarar sem rodeios:**

- ~~**A notificação push não está implantada.**~~ **Resolvido em T19b** — ver a entrada
  seguinte, "O aviso que alcança quem não abriu o sistema". O que continua verdadeiro, e que
  motivou a tarefa, é o diagnóstico: o in-app só alcança quem já abriu o sistema, e **a
  metade da RF08 que faltava era justamente a que ataca o gargalo do item 1**.
- **"Lido" é da loja, não de cada pessoa.** `Alerta.lidoEm` é uma coluna só: com dois
  gestores, o que um marcar sai da vista do outro. Numa loja pequena isso é adequado (é
  literalmente o mesmo balcão); em qualquer escala maior, leitura por usuário seria
  requisito, e é trabalho futuro.
- **O alerta não é reemitido.** Vale a decisão de T18: ele é a notícia da entrada na janela, e
  uma unidade que continua parada não volta a incomodar ninguém pela mesma janela. A forma
  prevista de insistir é configurar uma janela mais estreita em paralelo (7 dias, "última
  chamada"), que insiste com informação nova.

**Tarefa relacionada:** T19 (a entrega), T18 (a emissão), T17 (a janela), T13 (a fila, que
divide a tela com o alerta vencido), RF08, RF12/RF13

**Data:** 2026-09-09

---

## O aviso que alcança quem não abriu o sistema: o push e o que ele custa

**Contexto do problema:** a entrega in-app (T19) fechou a cadeia da RF08 até a tela, e deixou
declarado o gargalo — *"numa loja onde a gestora não abre o sistema, o alerta não chega a
ninguém"*. É uma limitação de processo, não de código: o software vigia o estoque todo dia, e
o resultado dessa vigilância fica esperando alguém decidir abri-lo. A notificação push é a
única parte do sistema que **inverte a iniciativa** — em vez de a pessoa consultar o software,
o software procura a pessoa. Vale registrar que essa é a diferença mais funda entre o processo
manual e o automatizado nesta perfumaria: no manual, quem vigia e quem decide são a mesma
pessoa no mesmo instante, e não existe "avisar".

**Quatro coisas apareceram ao implementar:**

1. **A entrega tem uma granularidade própria, diferente da do registro.** O `Alerta` é por
   unidade física desde T18, e precisa ser: é dele que a RF13 conta "a unidade alertada foi
   vendida antes de vencer?". A notificação **não pode** seguir a mesma granularidade — um
   recebimento de 40 frascos com a mesma validade entrando na janela dispararia 40
   notificações no mesmo segundo, e o efeito prático de 40 notificações é o de zero: a
   gestora desliga o aviso, e a RF08 morre no aparelho dela. A solução (uma notificação
   agregada por passagem, o detalhe na lista) é banal; o que não é banal, e vale ao artigo, é
   que **o dado da pesquisa e o aviso ao humano pedem formas diferentes do mesmo fato**, e
   confundi-las degrada os dois.

2. **O canal de entrega decidiu o que a tela pode prometer.** A configuração da janela (T17)
   já aceitava `PUSH` e `AMBOS` desde antes de existir push, e o aviso da tela precisou ser
   reescrito **quatro vezes** ao longo de T17, T18, T19 e T19b — a cada tarefa, dizendo
   exatamente até onde o sistema ia naquele momento. É um padrão que o trabalho adotou de
   propósito: quando uma funcionalidade é entregue por fatias, a interface tem que declarar a
   fatia atual, senão a configuração vira promessa falsa. O texto final não promete nem "você
   será avisado" nem "isto não funciona": diz que a notificação vale **para os aparelhos que
   tiverem autorizado o recebimento** — que é a verdade e é também o que a gestora precisa
   fazer a seguir.

3. **Push é o primeiro requisito cuja verificação não cabe na máquina de desenvolvimento.**
   Web Push exige contexto seguro (HTTPS ou `localhost`), permissão concedida pelo usuário e
   um serviço de push externo (FCM, Mozilla, Apple). A suíte cobre a regra — quem recebe,
   quantas notificações, o que acontece com a inscrição morta —, e o navegador automatizado
   cobre os estados da tela, **inclusive o de permissão negada**, que é o mais provável de
   acontecer na loja. O que nenhum dos dois cobre é a notificação chegando: isso é verificação
   de campo, no mesmo lote do teste de câmera de T10 e da leitura física do QR de T16. Vale
   como observação metodológica: **num PWA, a fronteira entre o que se testa e o que se
   confere em aparelho não é escolha do projeto, é imposta pela plataforma**.

4. **A automação da entrega criou uma dependência de infraestrutura que a loja não controla.**
   O alerta in-app depende do banco; o push depende de um serviço do fabricante do navegador
   estar de pé e alcançável. O sistema trata isso sem drama — 404/410 apagam a inscrição
   morta, outros erros são logados, e um push que falha não desfaz o alerta —, mas a
   consequência é real e assimétrica: **a lista in-app continua sendo a fonte de verdade, e o
   push é apenas o empurrão**. Foi essa assimetria que permitiu não construir fila de reenvio.

**Limitações a declarar sem rodeios:**

- **O log não isola o efeito do push.** A decisão consciente de parar em dez tipos de evento
  (T19) tem este preço: o `ALERTA_LIDO` diz que a gestora reconheceu o aviso, mas não diz se
  ela o reconheceu **porque a notificação chegou** ou porque abriu o sistema por conta
  própria. Como o efeito do push no tempo de reação é exatamente a pergunta que esta tarefa
  levanta, a resposta terá de vir de fora do log — comparando os períodos do piloto antes e
  depois da implantação, o que é mais fraco e precisa ser dito.
- **Push perdido está perdido.** Não há fila de reenvio: a passagem seguinte não reemite o
  alerta (a idempotência de T18), então uma notificação que falhou não volta. É aceitável
  porque a lista in-app não depende dela, mas significa que **o alcance do push é melhor que o
  do in-app, e ainda assim não é garantido**.
- **A notificação é da loja e chega a qualquer aparelho autorizado.** Como "lido" é da loja e
  não de cada gestor (T19), e a inscrição é do aparelho e não da pessoa, dois gestores com
  dois celulares recebem a mesma notificação e o reconhecimento de um vale pelos dois. Numa
  perfumaria com um ou dois gestores isso é adequado; em qualquer escala maior, seria
  requisito ter destinatário e leitura por pessoa.
- **O texto da notificação não nomeia produto, de propósito.** Notificação aparece em tela
  bloqueada, à vista de quem estiver por perto no balcão. É uma restrição de privacidade que
  o processo manual não tinha — na prateleira, quem lê a etiqueta é quem está diante dela.

**Tarefa relacionada:** T19b (o push), T19 (a entrega in-app, que ele empurra), T18 (a
varredura, único momento em que há o que notificar), T17 (o canal), T10 (o service worker e a
RNF07, que a solução preservou), RF08

**Data:** 2026-09-09

---

## O número que fecha o ciclo: o log deixa de ser arquivo e vira resposta

**Contexto do problema:** a RF12 construiu o `EventoLog` com duplo propósito declarado —
auditoria e **instrumento de coleta de dados quantitativos**. Durante cinco incrementos, só o
primeiro propósito esteve exercido: o log crescia, e ninguém o lia. A RF13 é o momento em que o
instrumento é lido, e ela revela uma coisa que não é sobre software — **o processo manual da
perfumaria não tem nenhum equivalente disso**. Na planilha e no caderno, a pergunta "quantas
vezes a atendente pegou o frasco errado no mês passado?" não é difícil de responder: ela é
impossível, porque o erro não deixa registro. O que a loja sabe hoje é o resultado final
(quantos frascos venceram), nunca o comportamento que levou até ele.

**O que apareceu na implementação:**

1. **O indicador central do trabalho depende de um dado que só existe porque o sistema bloqueia
   em vez de corrigir.** A "taxa de acerto na primeira leitura" só é calculável porque o FIFO
   bloqueia a saída errada, registra `ALERTA_FIFO_DISPARADO` e **espera** a leitura certa. Um
   sistema que simplesmente baixasse a unidade correta em silêncio — que seria mais rápido no
   balcão — teria a mesma saída física e **nenhum dado**. O bloqueio é, ao mesmo tempo, o
   mecanismo de controle e o instrumento de medida. Vale dizer isso explicitamente no artigo:
   a escolha de projeto que mais incomoda a operação é a que torna o experimento possível.

2. **"Alertas disparados vs. substituições efetivas" são duas tabelas, e a diferença entre elas
   é o abandono.** O bloqueio vem do `EventoLog`; a substituição, da `Saida`. Se os dois
   números viessem da mesma fonte, seriam iguais por construção e o "vs." da RF13 não teria
   conteúdo. A distância entre eles mede algo que nenhum dos dois mede sozinho: quantas vezes o
   sistema bloqueou e a venda **não** aconteceu — cliente que desistiu, atendente que parou.
   Na conferência contra o banco de desenvolvimento esse número apareceu grande (5 bloqueios,
   0 substituições), e ali era artefato de teste manual; num piloto real, é o indicador de
   fricção que decide se o controle é sustentável no balcão.

3. **O painel precisou declarar que fala de dois tempos ao mesmo tempo.** Estoque é fotografia
   do agora; perda, saída e override são de um período escolhido. É tentador espremer tudo num
   recorte só, e é assim que relatórios passam a mentir sem que ninguém perceba — "unidades em
   estoque no período" não significa nada, e um leitor que suponha que significa vai tirar
   conclusão errada. A resposta separa os dois em blocos distintos e ecoa o período. É uma
   observação metodológica que vale além deste sistema: **um painel que consolida estado e
   fluxo tem que dizer qual é qual, ou o número certo vira interpretação errada**.

4. **Uma decisão do FIFO reapareceu, três incrementos depois, como borda de gráfico.** A
   unidade que vence *hoje* continua vendável (é a borda `>= hoje` do passo 4 do FIFO), não
   entra na fila de descarte (T13), não gera alerta de vencida (T18) — e agora abre a faixa
   "até 7 dias" em vez da faixa "vencida". A mesma decisão de uma linha atravessou quatro
   requisitos diferentes. É um argumento concreto a favor da RNF03: a regra vive num lugar só
   **e** as consultas que a espelham derivam da mesma função de calendário, senão o sistema
   passa a discordar de si mesmo por um dia.

**Limitações a declarar sem rodeios:**

- **A taxa de acerto conta o override como acerto de primeira.** A venda autorizada de unidade
  vencida (PRD 6.1) grava `Saida` com zero tentativas, porque de fato não passou pelo laço do
  FIFO — e entra no denominador como se tivesse acertado de primeira. É raro por construção, e
  `overrides.total` está na mesma resposta para descontá-lo, mas **o número exibido não se
  autocorrige**. Quem ler o painel sem ler esta nota superestima o acerto na exata proporção
  dos overrides do período.
- **O painel não distingue a origem de um descarte.** `perdas.descartes` soma o frasco
  encontrado na varredura da fila (T13) e o descoberto no balcão durante uma venda — que são
  duas histórias operacionais diferentes, e uma delas (a do balcão) significa que o cliente
  presenciou a falha. A distinção existe no log, pela presença ou ausência de `LEITURA_QR_SAIDA`
  antes do `DESCARTE_REGISTRADO`, mas não sobe ao painel.
- **Não há série temporal, e a pergunta do TCC é sobre evolução.** O painel responde "como
  estão os números deste período", e a hipótese do trabalho é "a perda por vencimento diminuiu
  **depois** da adoção". Comparar dois períodos é possível chamando a rota duas vezes, mas a
  comparação em si acontece fora do sistema, na análise. É trabalho futuro honesto — e é
  também a razão de o recorte de período ser parâmetro desde o primeiro dia, e não uma janela
  fixa.
- **A perda é contada em unidades, nunca em dinheiro.** `Produto` não tem preço, e a
  perfumaria mede prejuízo em reais. O artigo pode apresentar a redução em unidades com
  honestidade, mas precisa dizer que a conversão para valor depende de um dado que o sistema
  deliberadamente não guarda.

**Tarefa relacionada:** T20 (os agregados), T12/RF12 (o log que eles leem), T09 (a `Saida` com
`tentativasAteAcerto`), T13 (a fila, cuja definição de "vencido" o painel reusa), T11 (o
override), RF13

**Data:** 2026-09-09

---

## O painel precisa dizer que tempo cada número descreve — e a tela é onde isso se prova

**Contexto do problema:** no controle manual, "quanto tem em estoque" e "quanto se perdeu no
mês" são perguntas feitas em momentos e cadernos diferentes, e ninguém as confunde. Num painel
elas aparecem lado a lado, na mesma tela, com a mesma tipografia — e passam a parecer o mesmo
tipo de fato. T20 já havia separado as duas naturezas na forma da resposta (`estoque` é o
agora; saídas, FIFO, descartes e overrides são do período). A pergunta que sobrou para T21 é
se essa separação sobreviveria à tela.

**Solução adotada:** dois blocos visualmente distintos, cada um com seu rótulo — "Estoque
agora: fotografia do momento, não muda com o período selecionado" e "No período — 11/08/2026 a
09/09/2026", com o intervalo escrito no próprio título. O período ecoado pelo servidor é o que
aparece ali: a tela não redige esse texto a partir do que o usuário digitou, e sim a partir do
que o servidor confirmou ter usado.

**Por que resolve o problema / trade-offs:** o leitor do painel não precisa saber que existem
dois recortes — precisa não ser enganado por eles. Escrever o intervalo no título do bloco é o
que impede a leitura "4 descartes" ser entendida como "4 descartes desde sempre". O custo é
uma tela mais verbosa do que o painel bonito de dashboards comerciais, que costumam apostar em
número grande sem legenda.

**Tarefa relacionada:** T21, T20, RF13

**Data:** 2026-09-09

---

## A limitação de um indicador tem que morar ao lado do indicador

**Contexto do problema:** a taxa de acerto na primeira leitura é o número que o TCC persegue —
é ele que responde "com que frequência a atendente pega o frasco certo de primeira". T20
descobriu, na conferência com dados reais, que a venda autorizada de unidade vencida (PRD 6.1)
entra nesse cálculo como acerto de primeira: ela grava zero tentativas porque de fato não
passou pelo laço do FIFO. O banco de desenvolvimento mostrou 100% de acerto em duas saídas,
sendo uma delas um override.

**Alternativas consideradas:** (1) corrigir a taxa excluindo os overrides do denominador —
recusada, porque mudaria o significado de um indicador já contratado e transformaria uma
limitação conhecida num número silenciosamente diferente; (2) manter o número limpo e deixar a
ressalva na documentação; (3) exibir a ressalva na tela, ao lado do número.

**Solução adotada:** a terceira. Sob a taxa, a tela escreve "inclui N venda(s) autorizada(s) de
unidade vencida, que não passaram pela validação de FIFO", usando o `overrides.total` que já
vem na mesma resposta. A taxa exibida continua sendo exatamente a que o servidor calculou.

**Por que resolve o problema / trade-offs:** a segunda alternativa faz a honestidade do
indicador depender de quem leu a documentação — e quem lê o painel raramente é quem lê a
documentação. Colar a ressalva ao número é o mais barato dos três e o único que alcança o
leitor no momento em que ele forma a conclusão. O trade-off é um painel menos limpo, com uma
nota de rodapé sob o indicador principal; e a nota não substitui a análise, que ainda precisa
descontar os overrides explicitamente se quiser a taxa "pura". É um exemplo pequeno de uma
prática que vale generalizar no artigo: **um instrumento de pesquisa deve carregar suas
próprias ressalvas na mesma superfície em que apresenta seus resultados.**

**Tarefa relacionada:** T21, T20, RF13, PRD 6.1

**Data:** 2026-09-09

---

## A tela que não sabe somar dias

**Contexto do problema:** o painel tem um recorte padrão — os últimos 30 dias. É a coisa mais
trivial de calcular no navegador (`hoje menos 29`), e é exatamente o tipo de cálculo que se
duplica sem pensar, porque parece pequeno demais para merecer uma requisição.

**Solução adotada:** a primeira carga vai **sem** `de`/`ate` na URL, e a tela descobre qual foi
o recorte lendo o `periodo` que o servidor devolve ecoado. Os campos do formulário começam
vazios e só são preenchidos com esse intervalo depois da primeira resposta.

**Por que resolve o problema / trade-offs:** o mesmo princípio da RNF03 e da RNF04, aplicado
onde ele parece exagero. Se a tela soubesse calcular o padrão, existiriam dois donos da mesma
regra, e no dia em que um mudasse (de 30 para 60 dias, digamos) o outro passaria a mentir sem
erro visível — o painel mostraria um intervalo no título e teria consultado outro. A mesma
disciplina governa o fuso: a tela não decide onde começa o dia, o que evita a distorção que
a RNF01 existe para prevenir na validade e que T20 encontrou entrando pela porta do recorte.
O custo é não ter os campos preenchidos no primeiro instante de render — o painel carrega
uma vez com os campos em branco.

**Tarefa relacionada:** T21, T20, RNF01, RNF04

**Data:** 2026-09-09

---

## O sistema pronto e o sistema instalável são coisas diferentes — e o segundo carrega um requisito funcional em arquivo de configuração

**Contexto do problema:** com T21 os treze RFs estão implementados e a suíte inteira passa.
É o momento em que um projeto de implementação de referência parece terminado — e a
avaliação de o que faltaria para a perfumaria **operar** o sistema encontrou duas coisas que
nenhuma tarefa cobria, porque nenhuma delas é um requisito funcional. A primeira é que o
único caminho para existir uma conta neste sistema é o seed de desenvolvimento: a gestora
não consegue criar a conta de uma atendente nova nem trocar a própria senha sem que alguém
execute SQL no banco. A RF01 foi lida, e implementada, como "autenticar"; a operação real
exige também "administrar quem autentica", que o processo manual resolvia sem sistema nenhum
— quem trabalha na loja é quem a dona conhece.

**Alternativas consideradas:** tratar o cadastro de usuário como configuração de instalação
(um script rodado uma vez pelo implantador) seria defensável para uma loja de sete pessoas e
custaria quase nada. Foi descartado porque a rotatividade de balcão é justamente o cenário em
que o dono do sistema não pode depender do desenvolvedor — e porque a senha compartilhada que
essa escolha implica destrói a atribuição de responsabilidade que o `EventoLog` existe para
registrar: um evento assinado por uma credencial que três pessoas conhecem não identifica
ninguém.

**Solução adotada:** T22 e T23, registradas no backlog como um incremento próprio,
explicitamente **posterior** ao fechamento dos RFs. A separação é intencional: o artigo
descreve um sistema cujos requisitos estão completos e cuja instalação ainda tem pré-condições.

**Por que resolve o problema / trade-offs:** a descoberta que interessa ao texto está na
segunda frente de T23. A decisão de T18 — colocar o relógio da RF08 **dentro do processo do
backend**, como `setInterval`, em vez de `cron` do sistema — foi tomada para que um requisito
funcional não dependesse de configuração no servidor da loja. Ela é correta, e depende de uma
premissa que nunca foi escrita em lugar nenhum: **existe um processo de longa duração**. Em
qualquer hospedagem serverless, que é o padrão gratuito ou barato hoje e a primeira coisa que
um projeto acadêmico tende a escolher, essa premissa é falsa: não há processo entre
requisições, o `setInterval` nunca dispara, e a RF08 sai do código para virar uma linha de
agendamento em arquivo de configuração da plataforma — exatamente o que T18 recusou. A
limitação honesta para o artigo não é "o sistema não roda em serverless", é mais desconfortável
que isso: **uma decisão de projeto sobre onde uma regra deve morar pode ser revertida pela
escolha de hospedagem, sem que ninguém a reveja, e o sintoma é um alerta que simplesmente não
chega.** A varredura é idempotente e silenciosa por construção (T18), então a falha não emite
erro — é o mesmo padrão de degradação sem sinal já registrado a propósito da suíte sem banco,
aqui aplicado a um requisito, não a um teste. Vale ao texto porque generaliza: soluções para
lojas de pequeno porte são publicadas junto com a promessa de baixo custo de operação, e o
tipo de hospedagem que torna esse custo baixo é o que reintroduz a dependência de
configuração externa que o projeto tinha eliminado de propósito.

**Tarefa relacionada:** T22, T23 (as tarefas criadas), T18 (a decisão do relógio no processo),
T03 (a RF01 como foi implementada), RF01, RF08

**Data:** 2026-09-09

---

## A garantia offline só vale a partir da segunda visita — e quem a sustenta antes disso é a hospedagem

**Contexto do problema:** a RNF07 existe porque o balcão não pode ficar sem saber o que fazer
quando a rede cai: o app instalado tem de abrir e **dizer** que está sem rede, em vez de
mostrar o erro do navegador, que não explica nada a quem está com um cliente na frente. T10
resolveu isso com o service worker e um `navigateFallback` para o app shell, e o comportamento
foi conferido em navegador com a rede desligada.

**Solução adotada:** um arquivo de configuração da hospedagem reescrevendo qualquer caminho
para `index.html`, ao lado do fallback que o service worker já fazia.

**Por que resolve o problema / trade-offs:** o que apareceu ao preparar o deploy é que o
fallback do service worker **não cobre a primeira visita**, e não podia cobrir: ele é código
que só passa a existir no aparelho depois de uma visita bem-sucedida. Como desde T10 cada tela
tem URL própria, o primeiro acesso a `/leitura` — que é exatamente como a atendente recebe o
link, e exatamente o que acontece ao recarregar a página — resolve no servidor, não no service
worker, e devolve a página de erro da hospedagem se nada tiver sido configurado lá. A
funcionalidade parece existir porque foi testada na ordem em que o desenvolvedor navega: abre
a raiz, faz login, clica no menu. A ordem em que o usuário chega é outra.

O ponto que interessa ao artigo é o formato do erro, mais do que o erro: **uma garantia
implementada em código ficou dependente de uma linha de configuração fora do repositório, e a
dependência não é declarada em lugar nenhum.** Nenhum teste alcança isso — não é lógica, é
roteamento de quem serve os arquivos — e a checagem que existia (`network-state-set offline`
no navegador de desenvolvimento) passava, porque o service worker já estava instalado ali. É a
mesma classe de degradação silenciosa já registrada a propósito da suíte que promete rodar sem
banco e do relógio da RF08 que assume um processo de longa duração: em todos os três casos, a
promessa continua escrita e verdadeira no código, e falsa no ambiente onde alguém usa.

Para um trabalho que propõe um PWA como substituto de controle manual em loja pequena, a
ressalva honesta é essa: **"funciona offline" é uma afirmação sobre a segunda visita em
diante**, e a primeira depende de configuração de infraestrutura que o artigo precisa
mencionar junto com o requisito, não como detalhe de implantação.

**Tarefa relacionada:** T23 (fatia 3), T10 (onde a RNF07 foi implementada), RNF07

**Data:** 2026-09-09

---

## O controle de segurança que atrapalharia a venda: por que o freio é do login e não da API

**Contexto do problema:** publicar o sistema num endereço público obriga a proteger o login
contra tentativa automatizada — duas contas conhecidas e um formulário aberto é varredura
livre. A resposta de manual é limitar requisições por origem, e a forma mais comum de aplicá-la
é global, na entrada da API inteira, porque é uma linha de configuração e cobre tudo.

**Alternativas consideradas:** limite global na API (descartado, ver abaixo); limite por conta
de e-mail em vez de por origem, descartado porque o atacante escolhe o e-mail que tenta e
trocá-lo a cada requisição contornaria a regra inteira.

**Solução adotada:** o limite existe **só** na rota de login, e o teste que mais importa não é
o que verifica a recusa — é o que verifica que trinta leituras de QR seguidas **não** são
recusadas.

**Por que resolve o problema / trade-offs:** o padrão de uso do balcão é o oposto do padrão
que um limite de requisições supõe. Um atendimento com seis frascos são seis leituras em
poucos segundos, e o laço de revalidação do FIFO multiplica isso justamente no caso ruim —
quando a atendente pegou a unidade errada e o sistema a manda buscar outra. Uma proteção
global transformaria o pior momento do atendimento (cliente esperando, frasco errado na mão)
no momento em que o sistema para de responder. **A medida de segurança teria degradado
exatamente o fluxo que o sistema existe para tornar viável**, e o sintoma apareceria no balcão
como lentidão inexplicável em dia de movimento — não como incidente de segurança.

Fica também uma limitação honesta sobre a granularidade possível: numa loja pequena, todos os
aparelhos saem por **um** endereço público, então "por origem" e "por loja" são a mesma coisa,
e a cota é compartilhada entre quem está vendendo. O número escolhido (dez por minuto) é
menos uma medida de segurança do que uma negociação com a ergonomia: precisa caber o erro de
digitação de duas pessoas no mesmo minuto. Quem sustenta a proteção de verdade é o tamanho
mínimo da senha somado ao custo do algoritmo de hash — o limite serve para tornar a varredura
inviável, não para ser a defesa principal. É um caso em que a literatura de segurança e a
realidade operacional de uma loja de sete pessoas pedem números diferentes, e vale dizer qual
dos dois governou a escolha.

**Tarefa relacionada:** T23 (fatia 1), T08 (o laço de revalidação), T10 (a rajada do balcão),
RF05, RF06

**Data:** 2026-09-09

---

## Revisão: o requisito não mudou de lugar, o gatilho mudou — e isso é o que dá para prometer

**Contexto do problema:** entrada anterior deste arquivo (*"O sistema pronto e o sistema
instalável são coisas diferentes"*) registrou que a decisão de T18 — colocar o relógio da RF08
**dentro** do processo, para que um requisito funcional não dependesse de configuração no
servidor da loja — apoia-se numa premissa nunca escrita: existir um processo de longa duração.
Em hospedagem serverless a premissa é falsa, e a conclusão era desconfortável: a escolha de
infraestrutura reverteria uma decisão de projeto sem que ninguém a revisse.

**Alternativas consideradas:** escolher serverless e mover a RF08 para configuração da
plataforma (reverteria T18); escolher processo persistente e não mexer em nada (preservaria
T18, mas ao custo de amarrar o trabalho a um tipo de hospedagem e de deixar a premissa
implícita de novo, agora só documentada).

**Solução adotada:** as duas formas coexistem. O agendador interno é ligado por variável de
ambiente, e existe uma rota autorizada por segredo para um agendador externo chamar. As duas
chamam a mesma função de varredura, que é a mesma que o comando de linha já chamava desde
T18 — três gatilhos, uma regra.

**Por que resolve o problema / trade-offs:** a revisão mostrou que a decisão de T18 estava
formulada de forma mais forte do que precisava. O que ela protegia de verdade não era "o job
roda dentro do processo", e sim **"a regra de o que é um alerta não vira configuração de
infraestrutura"** — e essa parte continua intacta em qualquer hospedagem, porque nenhum dos
três gatilhos sabe o que é um alerta. O que virou configuração foi o **gatilho**, que é
exatamente o tipo de coisa que muda de ambiente para ambiente e que não deveria estar
travada em código.

Para o artigo isso vale como refinamento honesto de uma afirmação anterior: uma implementação
de referência para loja de pequeno porte **não consegue** prometer independência de
infraestrutura para o *disparo* de um requisito periódico — em algum ponto alguém precisa ter
um relógio. O que ela consegue prometer, e o que se deve dizer, é que a **decisão** de negócio
não migra para lá junto. A diferença entre as duas promessas é o que separa um sistema
portável de um sistema cuja regra está espalhada pelo painel da hospedagem.

**Tarefa relacionada:** T23 (fatia 2), T18 (a decisão revista), e a entrada anterior sobre o
sistema instalável. RF08

**Data:** 2026-09-09
