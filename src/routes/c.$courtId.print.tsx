import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/c/$courtId/print')({
  component: PrintSheet,
})

function PrintSheet() {
  const { courtId } = Route.useParams()
  return (
    <main>
      <h1>Print sheet — {courtId}</h1>
      <p className="muted">Under construction.</p>
    </main>
  )
}
