import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThreadboxApp } from '@threadbox/ui'
import '../../../packages/ui/src/i18n'
import '../../../packages/ui/src/styles-v2.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThreadboxApp api={window.threadbox} />
  </StrictMode>
)
