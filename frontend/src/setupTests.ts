import '@testing-library/jest-dom/vitest'

// O jsdom não implementa rolagem, e a paginação rola até o início da lista ao
// mudar de página (T27). Sem isto, toda tela paginada quebraria no clique.
Element.prototype.scrollIntoView = () => {}
