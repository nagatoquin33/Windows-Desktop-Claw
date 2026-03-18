import React, { useState, useRef, useCallback } from 'react'
import './styles.css'

interface Props {
  onToggle?: (isOpen: boolean) => void
}

export function FloatingBall({ onToggle }: Props): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const movedRef = useRef(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      movedRef.current = false
      window.electronAPI.dragStart()

      const onMove = (): void => {
        movedRef.current = true
        window.electronAPI.dragMove()
      }

      const onUp = (): void => {
        window.electronAPI.dragEnd()
        // 没有发生移动才算点击
        if (!movedRef.current) {
          setIsOpen((prev) => {
            const next = !prev
            onToggle?.(next)
            return next
          })
        }
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onToggle]
  )

  return (
    <div className="ball-root">
      <div
        className={`ball${isOpen ? ' ball--open' : ''}`}
        onMouseDown={handleMouseDown}
        title={isOpen ? '关闭 Claw' : '打开 Claw'}
      >
        {/* 占位图标，替换为 logo.png 后删除此处 emoji */}
        <span className="ball__icon">🐾</span>
      </div>
    </div>
  )
}
