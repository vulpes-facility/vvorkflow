import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { applyColorScheme, systemColorScheme } from '@/shared/lib'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

// Select the theme before the first render, so that no element starts in the
// other theme and then fades to this one.
applyColorScheme(document.documentElement, systemColorScheme())

// The engine answers on this machine: a failed request does not get better
// with a second try.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
