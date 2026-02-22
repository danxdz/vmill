import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MachineProvider } from './MachineContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MachineProvider>
      <App />
    </MachineProvider>
  </StrictMode>,
)
