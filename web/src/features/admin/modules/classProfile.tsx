import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, classApi } from '@/shared/api'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { Button, Field, Input, Textarea, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

function ClassProfileAdmin() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['class', 'profile', i18n.language], queryFn: classApi.profile })
  const [motto, setMotto] = useState('')
  const [intro, setIntro] = useState('')
  const [foundedOn, setFoundedOn] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (!q.data) return
    setMotto(q.data.motto)
    setIntro(q.data.intro)
    setFoundedOn(q.data.foundedOn.slice(0, 10))
  }, [q.data])

  const save = useMutation({
    mutationFn: () => adminApi.updateClassProfile({ motto, intro, foundedOn, version: q.data!.version }),
    onSuccess: () => {
      toast.success(t('admin.classProfile.saved'))
      void qc.invalidateQueries({ queryKey: ['class'] })
    },
    onError: (e) => {
      setError(errorMessage(e))
      setFields(fieldErrors(e))
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setFields({})
    save.mutate()
  }

  return (
    <div className="page">
      <PageHeader title={t('admin.classProfile.title')} sub={`${t('admin.classProfile.name')}: ${q.data?.name ?? ''} · ${t('admin.classProfile.nameNote')}`} />
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={4}>
        <form className="form-stack form-narrow" style={{ maxWidth: 640 }} onSubmit={submit} noValidate>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Field label={t('admin.classProfile.motto')} error={fields.motto}>
            <Input value={motto} onChange={(e) => setMotto(e.target.value)} invalid={!!fields.motto} />
          </Field>
          <Field label={t('admin.classProfile.intro')} error={fields.intro}>
            <Textarea rows={6} value={intro} onChange={(e) => setIntro(e.target.value)} invalid={!!fields.intro} />
          </Field>
          <Field label={t('admin.classProfile.foundedOn')} error={fields.foundedOn}>
            <Input type="date" value={foundedOn} onChange={(e) => setFoundedOn(e.target.value)} invalid={!!fields.foundedOn} />
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </QueryBoundary>
    </div>
  )
}

registerAdminModule({
  id: 'class-profile',
  group: 'class',
  order: 10,
  label: 'admin.nav.classProfile',
  icon: 'info',
  path: 'class',
  permission: 'class.profile.write',
  element: ClassProfileAdmin,
})
