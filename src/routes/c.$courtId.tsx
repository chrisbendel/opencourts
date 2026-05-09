import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/c/$courtId')({ component: Court })

function Court() {
  const { courtId } = Route.useParams()
  return (
    <main>
      <h1>Court {courtId}</h1>
      <p className="muted">Under construction.</p>
    </main>
  )
}
