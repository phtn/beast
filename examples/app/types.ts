export interface AppProps {
  title: string
  themeClass: string
  user: { name: string; id: string; isAdmin: boolean }
  unreadCount: number
  messages: { id: string; text: string }[]
  groups: { id: string; title: string; status: string; items: { label: string; value: string }[] }[]
}
