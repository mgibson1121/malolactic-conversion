import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AccessKeyGate } from './components/AccessKeyGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessKeyGate>
      <App />
    </AccessKeyGate>
  </StrictMode>
)
