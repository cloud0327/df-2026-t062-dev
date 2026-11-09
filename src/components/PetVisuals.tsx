import type { ReactNode } from 'react'

export function PetIcon({ name, library = 'icons' }: { name: string, library?: 'icons' | 'lucide' }) {
  return <span className="assistant-icon" aria-hidden="true" style={{ maskImage: `url(/assistant/${library}/${name}.svg)` }} />
}

export function PetMessage({ children, home = false }: { children: ReactNode, home?: boolean }) {
  return (
    <div className={`assistant-message${home ? ' assistant-greeting' : ''}`}>
      {home && <h2 id="assistant-title">{children}</h2>}
      <img className="assistant-pet" src="/assistant/pet-peeking.png" alt="" />
      {!home && <p>{children}</p>}
    </div>
  )
}
