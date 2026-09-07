---
description: Executa a próxima tarefa pendente do backlog seguindo o file-based context do projeto
argument-hint: [ID de uma tarefa específica, ou ajuste de escopo — opcional]
---

Leia o CLAUDE.md deste repositório antes de fazer qualquer coisa.

Em seguida, abra tasks/backlog.md e identifique a próxima tarefa com status
"pendente" cujas dependências já estejam "concluída". Se eu tiver indicado
algo abaixo (o ID de uma tarefa específica, ou um ajuste de escopo), siga
essa instrução em vez da escolha automática: $ARGUMENTS

Se o arquivo de detalhe da tarefa (tasks/TNN-slug.md) ainda não existir,
gere-o antes de implementar, seguindo o mesmo formato dos arquivos já
existentes em tasks/ (objetivo, critério de aceite, notas técnicas, fora de
escopo), usando docs/arquitetura.md como fonte. Me mostre esse arquivo antes
de começar a implementar, para eu validar o escopo antes de você codar.

Implemente SOMENTE essa tarefa. Não adiante trabalho de tarefas futuras,
mesmo que pareça mais eficiente fazer junto.

Antes de finalizar, siga o checklist de fechamento de tarefa descrito no
CLAUDE.md (testes, commit, status do backlog, registro de decisões) — não
pule nenhum item mesmo que a tarefa pareça simples.

Ao final, me dê um resumo curto do que foi feito e do que eu devo revisar
manualmente antes de seguirmos para a próxima tarefa.
