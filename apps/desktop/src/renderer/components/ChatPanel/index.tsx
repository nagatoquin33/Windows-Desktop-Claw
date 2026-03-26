import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useClawSocket } from '../../hooks/useClawSocket'
import { CalendarView } from './CalendarView'
import { DayDetailView } from './DayDetailView'
import './styles.css'

type PanelTab = 'chat' | 'review'
type ReviewState = { view: 'calendar' } | { view: 'detail'; date: string }

export function ChatPanel(): React.JSX.Element {
  const { connectionState, messages, statusText, sendMessage } = useClawSocket()
  const connected = connectionState === 'connected'
  const [inputText, setInputText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('chat')
  const [reviewState, setReviewState] = useState<ReviewState>({ view: 'calendar' })

  // 消息列表自动滚到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text || !connected) return

    sendMessage(text)
    setInputText('')

    setTimeout(() => inputRef.current?.focus(), 0)
  }, [inputText, connected, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  const handleSwitchTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab)
    if (tab === 'review') setReviewState({ view: 'calendar' })
  }, [])

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div className="chat-panel__tabs">
          <button
            className={`chat-panel__tab ${activeTab === 'chat' ? 'chat-panel__tab--active' : ''}`}
            onClick={() => handleSwitchTab('chat')}
          >
            💬 对话
          </button>
          <button
            className={`chat-panel__tab ${activeTab === 'review' ? 'chat-panel__tab--active' : ''}`}
            onClick={() => handleSwitchTab('review')}
          >
            📅 回顾
          </button>
        </div>
        <button className="chat-panel__close" onClick={handleClose} title="关闭">×</button>
      </div>

      {activeTab === 'chat' ? (
        <>
          <div className="chat-panel__messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-panel__empty">
                有什么可以帮你的？🐾
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-msg chat-msg--${msg.role}`}
              >
                <div className="chat-msg__bubble">
                  {msg.content}
                  {msg.streaming && <span className="chat-msg__cursor" />}
                </div>
              </div>
            ))}
          </div>

          {statusText && (
            <div className="chat-panel__agent-status">{statusText}</div>
          )}

          <div className="chat-panel__input-area">
            {!connected && (
              <div className="chat-panel__status-bar">
                {connectionState === 'connecting' ? '连接中...' : '已断开，正在重连...'}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="chat-panel__input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={connected ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '等待连接...'}
              rows={1}
              disabled={!connected}
            />
            <button
              className="chat-panel__send"
              onClick={handleSend}
              disabled={!inputText.trim() || !connected}
              title="发送"
            >
              ↑
            </button>
          </div>
        </>
      ) : (
        <div className="chat-panel__review">
          {reviewState.view === 'calendar' ? (
            <CalendarView onSelectDate={(date) => setReviewState({ view: 'detail', date })} />
          ) : (
            <DayDetailView
              date={reviewState.date}
              onBack={() => setReviewState({ view: 'calendar' })}
            />
          )}
        </div>
      )}
    </div>
  )
}
