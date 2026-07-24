import { Amplify } from 'aws-amplify'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import outputs from '../amplify_outputs.json'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './utils/webNotification.ts'

Amplify.configure(outputs)
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
