import '@fontsource-variable/geist/index.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/600.css'
import './styles/tokens.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { configureApi, isApiError } from '@/shared/api'
import { initI18n } from '@/shared/i18n'
import { useAuth } from '@/features/auth/store'
import { App } from '@/app/App'

configureApi()
initI18n()
void useAuth.getState().boot()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
