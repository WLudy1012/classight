import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { meApi } from '@/shared/api'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { useAuth } from '@/features/auth/store'
import { Avatar, Button, Field, Input, Textarea, toast } from '@/shared/ui'

export function ProfilePage() {
  const { t } = useTranslation()
  const { user, setUser } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  if (!user) return null

  const refresh = async () => {
    const fresh = await meApi.profile()
    setUser(fresh)
    void qc.invalidateQueries({ queryKey: ['me'] })
    return fresh
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setFields({})
    try {
      const updated = await meApi.updateProfile({ displayName, email, bio, version: user.version })
      setUser(updated)
      void qc.invalidateQueries({ queryKey: ['me'] })
      toast.success(t('common.saved'))
    } catch (err) {
      setError(errorMessage(err))
      setFields(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setAvatarBusy(true)
    try {
      await meApi.uploadAvatar(file, user.version)
      await refresh()
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAvatar = async () => {
    setAvatarBusy(true)
    try {
      await meApi.deleteAvatar(user.version)
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">{t('console.profileTitle')}</h1>

      <section className="page__section" aria-labelledby="p-avatar">
        <h2 id="p-avatar" className="page__h">
          {t('console.avatar')}
        </h2>
        <div className="rowline">
          <Avatar name={user.displayName} src={user.avatarUrl} size={64} />
          <div className="stack-sm">
            <div className="row-gap">
              <Button size="sm" icon="image" loading={avatarBusy} onClick={() => fileRef.current?.click()}>
                {t('console.avatarUpload')}
              </Button>
              {user.avatarUrl && (
                <Button size="sm" variant="ghost" onClick={() => void removeAvatar()} disabled={avatarBusy}>
                  {t('console.avatarRemove')}
                </Button>
              )}
            </div>
            <span className="muted small">{t('console.avatarNote', { mb: 10 })}</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      </section>

      <form className="page__section form-stack form-narrow" onSubmit={save} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Field label={t('console.displayName')} error={fields.displayName}>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} invalid={!!fields.displayName} required />
        </Field>
        <Field label={t('console.email')} error={fields.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('console.bio')}>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </div>
  )
}
