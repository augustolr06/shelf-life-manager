import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
// Fontes do build, e não do Google Fonts: o arquivo entra no precache do
// service worker, e o app instalado abre offline com elas (RNF07, T40). Só o
// subconjunto latino, que cobre o português, e só os pesos que o CSS usa.
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-800.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './estilos.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Elemento #root não encontrado em index.html')
}

// O roteador fica aqui, e não dentro do `App`, para que os testes montem o
// `App` sob `MemoryRouter` com a rota inicial que cada caso precisa.
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
