import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/courts')({ component: Courts })

function Courts() {
  return (
    <main>
      <h1>Browse courts</h1>
      <p className="muted">Under construction.</p>
    </main>
  )
}
