import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Badge, Button, ConfirmDialog, Field, Icon, Input, LinkButton, Skeleton, StateView, Textarea, toast } from '@/shared/ui'
import { blogApi, type Article, type ArticleInput, type ArticleSummary } from './api'
import './blog.css'

const root = '/center/blog'

export default function BlogPage() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  useDocumentTitle(t('blog.title'))
  return <Routes key={user?.id}>
    <Route index element={<BlogIndex />} />
    <Route path="new" element={can(user, 'blog.write') ? <Editor /> : <BlogUnavailable />} />
    <Route path=":id" element={<ArticleRoute />} />
    <Route path=":id/edit" element={<ArticleRoute editing />} />
    <Route path="*" element={<BlogUnavailable />} />
  </Routes>
}

function BlogUnavailable({ error, retry }: { error?: unknown; retry?: () => void }) {
  const { t } = useTranslation()
  return <div className="page blog-page">
    <LinkButton to={root} variant="ghost" icon="arrowLeft">{t('blog.back')}</LinkButton>
    <StateView icon="alert" title={t('common.error')} body={error ? errorMessage(error) : undefined} action={retry && <Button onClick={retry}>{t('common.retry')}</Button>} />
  </div>
}

function BlogIndex() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const [scope, setScope] = useState<'published' | 'mine'>('published')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: ['blog', user?.id, scope, search, page], queryFn: ({ signal }) => blogApi.list(scope, search.trim(), page, signal) })
  const lastPage = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.pageSize)) : 1
  return <div className="page blog-page">
    <header className="row-between blog-heading">
      <h1 className="page__title">{t('blog.title')}</h1>
      {can(user, 'blog.write') && <LinkButton to={`${root}/new`} variant="primary" icon="edit">{t('blog.new')}</LinkButton>}
    </header>
    <div className="blog-toolbar">
      <div className="blog-filters" role="group" aria-label={t('blog.title')}>
        {(['published', 'mine'] as const).map((tab) => <Button key={tab} variant={scope === tab ? 'secondary' : 'ghost'} aria-pressed={scope === tab} onClick={() => { setScope(tab); setPage(1) }}>{t(`blog.${tab}`)}</Button>)}
      </div>
      <Input type="search" maxLength={100} aria-label={t('blog.search')} placeholder={t('blog.search')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
    </div>
    {query.isPending && <div className="blog-skeletons" aria-busy="true"><Skeleton h={64} /><Skeleton h={64} /></div>}
    {query.isError && <StateView icon="alert" title={t('common.error')} body={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>{t('common.retry')}</Button>} />}
    {query.data && <>
      {query.data.items.length ? <ul className="blog-list">
        {query.data.items.map((item) => <li key={item.id}>
          <Link to={`${root}/${item.id}`} className="blog-list__link">
            <div>
              <h2>{item.title}</h2>
              {item.summary && <p>{item.summary}</p>}
              <ArticleMeta item={item} />
            </div>
            <Icon name="chevronRight" />
          </Link>
        </li>)}
      </ul> : <StateView icon={search.trim() ? 'search' : 'file'} title={t(search.trim() ? 'blog.noMatch' : scope === 'mine' ? 'blog.mineEmpty' : 'blog.empty')} />}
      {(page > 1 || lastPage > 1) && <div className="blog-pagination">
        <Button size="sm" variant="ghost" icon="chevronLeft" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('blog.previous')}</Button>
        <span className="num">{page} / {lastPage}</span>
        <Button size="sm" variant="ghost" iconRight="chevronRight" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>{t('blog.next')}</Button>
      </div>}
    </>}
  </div>
}

function ArticleMeta({ item }: { item: ArticleSummary }) {
  const { t } = useTranslation()
  const date = item.publishedAt ?? item.updatedAt
  return <div className="blog-meta"><span>{item.authorName}</span><time dateTime={date}>{formatDate(date)}</time>{!item.publishedAt && <Badge>{t('blog.draft')}</Badge>}</div>
}

function ArticleRoute({ editing }: { editing?: boolean }) {
  const { id = '' } = useParams()
  const user = useAuth((state) => state.user)
  const valid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
  const query = useQuery({ queryKey: ['blog', user?.id, 'article', id], queryFn: ({ signal }) => blogApi.read(id, signal), enabled: valid })
  if (!valid || query.isError) return <BlogUnavailable error={query.error} retry={valid ? () => void query.refetch() : undefined} />
  if (query.isPending) return <div className="page blog-page blog-skeletons" aria-busy="true"><Skeleton w="55%" h={42} /><Skeleton h={160} /></div>
  if (editing) return can(user, 'blog.write') && query.data.info.authorId === user?.id ? <Editor key={id} article={query.data} /> : <BlogUnavailable />
  return <ArticleDetail key={id} article={query.data} />
}

function ArticleDetail({ article }: { article: Article }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuth((state) => state.user)
  const [confirm, setConfirm] = useState<'delete' | 'draft' | null>(null)
  const { info, body } = article
  const owner = info.authorId === user?.id && can(user, 'blog.write')
  const canRemove = owner || !!info.publishedAt && can(user, 'blog.moderate')
  const action = useMutation({
    mutationFn: async (mode: 'delete' | 'draft') => {
      if (mode === 'delete') { await blogApi.remove(info); return null }
      return blogApi.save(info.id, { title: info.title, summary: info.summary, body, version: info.version, published: false })
    },
    onSuccess: (result) => {
      setConfirm(null)
      if (result) qc.setQueryData(['blog', user?.id, 'article', info.id], result)
      else { qc.removeQueries({ queryKey: ['blog', user?.id, 'article', info.id] }); navigate(root, { replace: true }) }
      void qc.invalidateQueries({ queryKey: ['blog', user?.id] })
      toast.success(t(result ? 'blog.saved' : 'blog.removed'))
    },
    onError: (error) => { toast.error(errorMessage(error)); void qc.invalidateQueries({ queryKey: ['blog', user?.id, 'article', info.id] }) },
  })
  return <div className="page blog-page">
    <div className="row-between blog-heading">
      <LinkButton to={root} variant="ghost" icon="arrowLeft">{t('blog.back')}</LinkButton>
      <div className="row-actions">
        {owner && <LinkButton to={`${root}/${info.id}/edit`} size="sm" icon="edit">{t('blog.edit')}</LinkButton>}
        {owner && info.publishedAt && <Button size="sm" variant="ghost" onClick={() => setConfirm('draft')}>{t('blog.unpublish')}</Button>}
        {canRemove && <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label={t('blog.remove')} onClick={() => setConfirm('delete')} />}
      </div>
    </div>
    <article className="blog-article">
      <header><h1 className="page__title">{info.title}</h1><ArticleMeta item={info} />{info.summary && <p className="blog-article__summary">{info.summary}</p>}</header>
      <div className="blog-article__body">{body}</div>
    </article>
    <ConfirmDialog open={confirm !== null} danger={confirm === 'delete'} title={t(confirm === 'draft' ? 'blog.unpublish' : 'blog.remove')}
      body={confirm === 'draft' ? t('blog.unpublishPrompt') : t('blog.removePrompt', { title: info.title })} loading={action.isPending}
      onConfirm={() => { if (confirm) action.mutate(confirm) }} onClose={() => setConfirm(null)} />
  </div>
}

function Editor({ article }: { article?: Article }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuth((state) => state.user)
  const [draft, setDraft] = useState<ArticleInput>(() => ({ title: article?.info.title ?? '', summary: article?.info.summary ?? '', body: article?.body ?? '', published: !!article?.info.publishedAt, version: article?.info.version }))
  const published = !!article?.info.publishedAt
  const save = useMutation({
    mutationFn: (publish: boolean) => blogApi.save(article?.info.id, { ...draft, published: publish }),
    onSuccess: (result) => {
      qc.setQueryData(['blog', user?.id, 'article', result.info.id], result)
      void qc.invalidateQueries({ queryKey: ['blog', user?.id] })
      navigate(`${root}/${result.info.id}`, { replace: true })
      toast.success(t('blog.saved'))
    },
  })
  return <div className="page blog-page">
    <LinkButton to={article ? `${root}/${article.info.id}` : root} variant="ghost" icon="arrowLeft">{t(article ? 'common.cancel' : 'blog.back')}</LinkButton>
    <form className="blog-editor" onSubmit={(event) => {
      event.preventDefault()
      const submitter = (event.nativeEvent as SubmitEvent).submitter
      const publish = published || submitter?.getAttribute('value') === 'publish'
      if (draft.title.trim() && (!publish || draft.body.trim()) && !save.isPending) save.mutate(publish)
    }}>
      <h1 className="page__title">{t(article ? 'blog.edit' : 'blog.new')}</h1>
      <Field label={t('blog.titleField')}><Input required maxLength={160} readOnly={save.isPending} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field label={t('blog.summaryField')}><Input maxLength={280} readOnly={save.isPending} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></Field>
      <Field label={t('blog.body')}><Textarea rows={12} maxLength={16000} readOnly={save.isPending} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
      {save.isError && <p role="alert" className="field__error">{errorMessage(save.error)}</p>}
      <div className="row-actions">
        {!published && <Button type="submit" value="draft" disabled={!draft.title.trim() || save.isPending} loading={save.isPending && save.variables === false}>{t('blog.saveDraft')}</Button>}
        <Button type="submit" value="publish" variant="primary" disabled={!draft.title.trim() || !draft.body.trim() || save.isPending} loading={save.isPending && save.variables === true}>{t(published ? 'blog.saveChanges' : 'blog.publish')}</Button>
      </div>
    </form>
  </div>
}
