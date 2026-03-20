import React, { useState, useEffect, useCallback } from 'react'
import './styles.css'

interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
}

const defaultConfig: LLMConfig = {
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o'
}

export function SettingsPanel(): React.JSX.Element {
  const [config, setConfig] = useState<LLMConfig>(defaultConfig)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    window.electronAPI.getConfig().then((c) => {
      if (c?.llm) setConfig({ ...defaultConfig, ...c.llm })
    })
  }, [])

  const handleSave = useCallback(async () => {
    await window.electronAPI.setConfig({ llm: config })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [config])

  const handleClose = useCallback(() => {
    window.electronAPI.closeWindow()
  }, [])

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <span className="settings-panel__title">设置</span>
        <button className="settings-panel__close" onClick={handleClose} title="关闭">
          ×
        </button>
      </div>

      <div className="settings-panel__body">
        <section className="settings-section">
          <h3 className="settings-section__title">LLM 配置</h3>

          <label className="settings-field">
            <span className="settings-field__label">API Key</span>
            <div className="settings-field__input-group">
              <input
                type={showKey ? 'text' : 'password'}
                className="settings-field__input"
                value={config.apiKey}
                onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="sk-..."
              />
              <button
                className="settings-field__toggle"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span className="settings-field__label">Base URL</span>
            <input
              type="url"
              className="settings-field__input"
              value={config.baseURL}
              onChange={(e) => setConfig((prev) => ({ ...prev, baseURL: e.target.value }))}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <label className="settings-field">
            <span className="settings-field__label">Model</span>
            <input
              type="text"
              className="settings-field__input"
              value={config.model}
              onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="gpt-4o"
            />
          </label>
        </section>
      </div>

      <div className="settings-panel__footer">
        <button className="settings-panel__save" onClick={handleSave}>
          {saved ? '✓ 已保存' : '保存'}
        </button>
      </div>
    </div>
  )
}
