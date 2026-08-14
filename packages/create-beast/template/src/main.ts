import { createRoot } from 'octane'
import App from './App.btsx'
import './style.css'

const container = document.getElementById('app')
if (container === null) throw new Error('Missing #app container.')

const links = [
  { id: 'beast', label: 'Beast Docs', url: 'https://beast-docs.vercel.app' },
  { id: 'tsrx', label: 'Explore TSRX', url: 'https://tsrx.dev' },
  { id: 'octane', label: 'Octane JS', url: 'https://octanejs.dev' }
]

createRoot(container).render(App, { title: 'Beast → Octane', links })
