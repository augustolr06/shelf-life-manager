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
