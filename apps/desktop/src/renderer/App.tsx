import React from 'react'
import { FloatingBall } from './components/FloatingBall'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'

const view = new URLSearchParams(window.location.search).get('view')

function App(): React.JSX.Element {
  if (view === 'panel') return <ChatPanel />
  if (view === 'settings') return <SettingsPanel />
  return <FloatingBall />
}

export default App
