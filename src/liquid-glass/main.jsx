import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Home,
  Search,
  Settings,
  MessageSquareText,
  Camera,
  ArrowLeft,
} from 'lucide-react'
import LiquidGlassPill, { PILL_DEFAULTS } from './LiquidGlassPill.jsx'
import './demo.css'

function Demo() {
  const [active, setActive] = useState('home')

  const items = [
    { id: 'home', label: 'Home', icon: <Home size={22} strokeWidth={2} /> },
    {
      id: 'feed',
      label: 'Feed',
      icon: (
        <span className="nav-icon-wrap">
          <MessageSquareText size={22} strokeWidth={2} />
          <span className="nav-dot" />
        </span>
      ),
    },
    { id: 'search', label: 'Search', icon: <Search size={22} strokeWidth={2} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={22} strokeWidth={2} /> },
  ]

  return (
    <div className="stage">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
      <div className="orb orb-d" />
      <div className="orb orb-e" />

      <a className="back" href="/">
        <ArrowLeft size={15} />
        Dashboard
      </a>

      <div className="phone">
        <div className="glass-sheet">
          <button type="button" className="capture">
            <Camera size={16} strokeWidth={2.2} />
            Capture
          </button>

          <div className="sheet-body">
            <p className="label">Liquid Glass</p>
            <h1>
              Soft light.
              <br />
              Frosted depth.
            </h1>
            <p className="hint">
              archisvaze/liquid-glass · Pill · IOR {PILL_DEFAULTS.ior}
            </p>
          </div>

          {/* WebGL refraction pill — exact shader from liquid-glass-eta.vercel.app/webgl.html */}
          <LiquidGlassPill bottom={28} />

          {/* Icon hit-targets over the glass pill */}
          <nav className="pill-nav" aria-label="Primary">
            {items.map((item) => {
              const isActive = item.id === active
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pill-tab${isActive ? ' is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActive(item.id)}
                >
                  <span className="pill-icon">{item.icon}</span>
                  <span className="pill-label">{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Demo />)
