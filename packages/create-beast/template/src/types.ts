export interface HeaderProps {
  source: string
  direction: string
  output: string
}
export interface Props extends HeaderProps {
  links: { id: string; label: string; url: string }[]
}
