/**
 * Courseware bytes for the mock. Deliberately NOT in localStorage (decks are megabytes): they live
 * in this Map for the lifetime of the page. After a reload the metadata is still there but the file
 * is gone, and the preview says so instead of failing.
 */
const files = new Map<string, File>()

export const putFile = (coursewareId: string, file: File) => void files.set(coursewareId, file)
export const getFile = (coursewareId: string) => files.get(coursewareId)
export const dropFile = (coursewareId: string) => void files.delete(coursewareId)
export const clearFiles = () => files.clear()
