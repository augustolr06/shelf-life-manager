import '@testing-library/jest-dom/vitest'
import { toast } from 'sonner'
import { afterEach } from 'vitest'

// O jsdom não implementa rolagem, e a paginação rola até o início da lista ao
// mudar de página (T27). Sem isto, toda tela paginada quebraria no clique.
Element.prototype.scrollIntoView = () => {}

// Os toasts vivem num estado global da biblioteca, e um `<Toaster />` recém-
// montado reapresenta os que continuam ativos (T29). Sem isto, o erro de um
// teste — que não some sozinho — apareceria na tela do teste seguinte.
afterEach(() => {
  toast.dismiss()
})
