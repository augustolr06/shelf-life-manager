Troquei a senha da atendente no banco de produção.

- Usuário: atendente@estoque.local
- Senha: QwGnH-zXkD7-eehbW-JZ3hN

melhorias:


- fazer com a leitura do QrCode leia apenas um e, ao identificar o produto, pare de ler (feche a câmera) e mostre os dados do produto;
- implementar o carrinho, pois atualmente, ao ler o QrCode, o sistema registra a saída sem perguntar se o usuário deseja vender ou não o produto, e não há como desfazer a ação;
- implementar uma tela de visualização de produto lido pelo QrCode, onde a câmera se manterá aberta esperando o qrCode do próximo produto e, ao ler o qrCode, a tela mostra os dados do produto lido somente, sem registrar a saída do produto;
- Melhorar a mensagem de erro de quando tenta cadastrar um produto com um nome de mais de 120 caracteres;
- Na tela Catálogo de Produtos, a busca por produtos deve ser em tempo real, ou seja, filtrar ao digitar e não ter que esperar clicar em buscar para mostrar os resultados. Isso
ajuda na questão de voltar a mostrar todos os produtos;
- Melhorar paginação, substituindo os botões anterior e próxima por aqueles mais comuns (botão de avançar, voltar, página específica, ir até o fim, voltar ao início, etc)
- Transformar a busca por produto e o select de escolha do produto em uma coisa só: um campo de seleção que permite filtrar os produtos pelo que foi digitado. O que será usado é um produto (item da lista) e não o que foi digitado como texto;
- Substituir mensagens de erro e suceso por toasts (instalar lib, se necessário)
- Aviso de sessão expirada deveria ser um toast ou um modal que leva para a tela de login
- fazer um redesign do app. Além de melhorar a estética, algumas melhorias que devem ser feitas:
  - Melhorar copies;
  - Dar mais destaque para produtos vencidos
  - dar destaque para o "vender mesmo assim" e outras ações destrutivas;
  - implementar responsividade no app para mobile e tablet;
  - Diferenciar melhor para os produtos inativos