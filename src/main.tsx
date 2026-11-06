import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import UpdateNotice from './components/UpdateNotice'
import './index.css'
import { UpdatesProvider } from './lib/updates'
import { applyTheme, readTheme } from './lib/prefs'

// Before the first render, so the app doesn't flash the wrong colors.
applyTheme(readTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UpdatesProvider>
      <App />
      <UpdateNotice />
    </UpdatesProvider>
  </React.StrictMode>,
)
