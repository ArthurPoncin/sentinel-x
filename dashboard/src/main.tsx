import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/app'
import { STATUS_COLORS } from '@/shared/config/status-colors'
import '@/app/styles.css'

// The stylesheet's --nominal, --elevated and --critical. Set before the first render: nothing shows without them.
for (const [level, color] of Object.entries(STATUS_COLORS)) {
  document.documentElement.style.setProperty(`--${level}`, color)
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
