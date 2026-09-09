import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopApp from './DesktopApp'
import '../../../packages/ui/src/i18n'
import '../../../packages/ui/src/styles-v2.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopApp api={window.threadbox} />
  </StrictMode>
)
