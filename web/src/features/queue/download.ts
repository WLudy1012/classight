import { speechApi, type Courseware } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { toast } from '@/shared/ui'

/** Authenticated download: the Bearer token cannot ride on a plain <a href>, so fetch the blob and save it. */
export async function downloadCourseware(c: Pick<Courseware, 'id' | 'originalName'>) {
  try {
    const blob = await speechApi.downloadCourseware(c.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = c.originalName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    toast.error(errorMessage(e))
  }
}
