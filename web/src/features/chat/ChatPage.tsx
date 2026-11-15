import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { isApiError } from '@/shared/api'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Button, ConfirmDialog, Skeleton, StateView, Textarea, toast } from '@/shared/ui'
import { chatApi, type Message } from './api'
import './chat.css'

const atEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 60
const day = (message: Message) => new Date(message.sentAt).toDateString()

function newMessageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function ChatPage() {
  const id = useAuth((state) => state.user?.id)
  return <Conversation key={id} />
}

function Conversation() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const qc = useQueryClient()
  const [before, setBefore] = useState<number>()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [following, setFollowing] = useState(true)
  const [confirm, setConfirm] = useState<Message | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const attempt = useRef<{ body: string; id: string } | null>(null)
  const sendPermission = can(user, 'chat.send')
  const moderate = can(user, 'chat.moderate')
  useDocumentTitle(t('chat.title'))

  const prefix = ['chat', user?.id] as const
  const query = useQuery({
    queryKey: [...prefix, before ?? 'latest'],
    queryFn: ({ signal }) => chatApi.list(before, signal),
    refetchInterval: 4000,
    retry: false,
  })
  const unavailable = isApiError(query.error) && [401, 403, 404].includes(query.error.status)
  const data = unavailable ? undefined : query.data
  const messages = data?.items
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el || !messages || !following) return
    el.scrollTop = before === undefined ? el.scrollHeight : 0
  }, [messages, following, before])

  const refresh = () => void qc.invalidateQueries({ queryKey: prefix })
  const send = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => chatApi.send(id, body),
    onSuccess: () => {
      setText(''); setError(''); setBefore(undefined); setFollowing(true)
      attempt.current = null
      refresh()
    },
    onError: (problem) => setError(errorMessage(problem)),
    onSettled: () => requestAnimationFrame(() => composer.current?.focus()),
  })
  const remove = useMutation({
    mutationFn: chatApi.remove,
    onSuccess: () => { setConfirm(null); refresh() },
    onError: (problem) => toast.error(errorMessage(problem)),
  })
  function submit() {
    const body = text.trim()
    if (!body || send.isPending || !sendPermission || unavailable) return
    if (attempt.current?.body !== body) attempt.current = { body, id: newMessageId() }
    setError('')
    send.mutate(attempt.current)
  }
  function latest() {
    setBefore(undefined)
    setFollowing(true)
  }
  function trackScroll() {
    if (!viewport.current) return
    if (before === undefined) setFollowing(atEnd(viewport.current))
  }

  return <div className="page chat-page">
    <header className="row-between chat-heading">
      <h1 className="page__title">{t('chat.title')}</h1>
      <div className="row-actions">
        {data?.before && <Button size="sm" variant="ghost" icon="clock" onClick={() => { setBefore(data.before!); setFollowing(true) }}>{t('chat.history')}</Button>}
        {(before !== undefined || !following) && <Button size="sm" icon="arrowDown" onClick={latest}>{t('chat.latest')}</Button>}
      </div>
    </header>
    <section className="chat-conversation" aria-label={t('chat.messages')}>
      {query.isError && data && <div className="chat-status" role="status">{t('chat.stale')} <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>{t('common.retry')}</Button></div>}
      <div className="chat-viewport" ref={viewport} tabIndex={0} onScroll={trackScroll} aria-label={t('chat.messages')}>
        {query.isPending && <div className="chat-skeletons" aria-busy="true" aria-label={t('chat.connecting')}><Skeleton w="50%" h={48} /><Skeleton w="70%" h={48} /></div>}
        {query.isError && !data && <StateView icon="alert" title={t('chat.stale')} body={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>} />}
        {messages && !messages.length && <StateView icon="chat" title={t('chat.empty')} />}
        {!!messages?.length && <ol className="chat-lines" aria-live={before === undefined ? 'polite' : 'off'} aria-relevant="additions">
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const newDay = !previous || day(previous) !== day(message)
            const owner = message.senderId === user?.id
            return <li key={message.id}>
              {newDay && <div className="chat-day"><time dateTime={message.sentAt}>{formatDate(message.sentAt, { dateStyle: 'long' })}</time></div>}
              <div className={`chat-entry${owner ? ' chat-entry--own' : ''}`}>
                <div className="chat-entry__details">
                  <strong>{message.senderName}</strong>
                  <time dateTime={message.sentAt} className="num">{formatDate(message.sentAt, { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
                <div className="chat-entry__content">
                  <p className="chat-entry__body" data-deleted={message.deleted}>{message.deleted ? t('chat.removed') : message.body}</p>
                  {!message.deleted && (moderate || owner && sendPermission) && <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label={t(owner ? 'chat.withdraw' : 'chat.remove')} onClick={() => setConfirm(message)} />}
                </div>
              </div>
            </li>
          })}
        </ol>}
      </div>
      {sendPermission && !unavailable && <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Textarea ref={composer} aria-label={t('chat.composer')} placeholder={t('chat.composer')} rows={2} maxLength={2000} readOnly={send.isPending} value={text}
          onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
          }} />
        <Button type="submit" variant="primary" iconRight="arrowRight" disabled={!text.trim()} loading={send.isPending}>{t('chat.send')}</Button>
        <p className={error ? 'field__error' : 'muted small'} role={error ? 'alert' : undefined}>{error || t('chat.hint')}</p>
      </form>}
    </section>
    <ConfirmDialog open={confirm !== null} danger title={t(confirm?.senderId === user?.id ? 'chat.withdraw' : 'chat.remove')} body={t('chat.removePrompt')} loading={remove.isPending}
      onConfirm={() => { if (confirm) remove.mutate(confirm.id) }} onClose={() => setConfirm(null)} />
  </div>
}
