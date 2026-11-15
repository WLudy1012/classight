import { del, get, post } from '@/shared/api/client'

export interface Message {
  id: number
  senderId: string
  senderName: string
  body: string
  sentAt: string
  deleted: boolean
}
export interface ChatPage { items: Message[]; before: number | null }

const path = '/plugins/chat/api/messages'
export const chatApi = {
  list: (before: number | undefined, signal?: AbortSignal) => get<ChatPage>(path, { before }, signal),
  send: (clientId: string, body: string) => post<Message>(path, { clientId, body }),
  remove: (id: number) => del(`${path}/${id}`),
}
