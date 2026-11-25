import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateNotice from './components/UpdateNotice'
import './index.css'
import { UpdatesProvider } from './lib/updates'
import { applyAppearance, initSystemTheme } from './lib/appearance'
import { I18nProvider } from './i18n'

// Before the first render, so the app doesn't flash the wrong colors.
applyAppearance()
initSystemTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UpdatesProvider>
      <I18nProvider>
        <App />
        <UpdateNotice />
      </I18nProvider>
    </UpdatesProvider>
  </React.StrictMode>,
)
