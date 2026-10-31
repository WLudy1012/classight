import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './kit.css'

/**
 * Drop target + file picker in one control. Corner brackets appear while a file is over it
 * (the same mark as the cursor). The whole zone is one button for keyboard and screen readers.
 */
export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled,
  busy,
  icon = 'upload',
  title,
  hint,
  error,
  compact,
}: {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  busy?: boolean
  icon?: IconName
  title: ReactNode
  hint?: ReactNode
  error?: ReactNode
  compact?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const off = disabled || busy

  const pick = () => {
    if (!off) input.current?.click()
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    if (off) return
    const files = [...e.dataTransfer.files]
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick()
    }
  }

  return (
    <div className="dropzone-wrap">
      <div
        className="dropzone"
        data-over={over || undefined}
        data-compact={compact || undefined}
        data-invalid={!!error || undefined}
        role="button"
        tabIndex={off ? -1 : 0}
        aria-disabled={off || undefined}
        onClick={pick}
        onKeyDown={key}
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current += 1
          if (!off) setOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        }}
        onDrop={drop}
      >
        <i className="dropzone__c dropzone__c--tl" />
        <i className="dropzone__c dropzone__c--tr" />
        <i className="dropzone__c dropzone__c--bl" />
        <i className="dropzone__c dropzone__c--br" />
        <Icon name={icon} size={compact ? 20 : 24} />
        <div className="dropzone__text">
          <span className="dropzone__title">{title}</span>
          {hint && <span className="dropzone__hint">{hint}</span>}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) onFiles(files)
          }}
        />
      </div>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
