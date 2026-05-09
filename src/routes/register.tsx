import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/register')({ component: Register })

function Register() {
  return (
    <main>
      <h1>Register a court</h1>
      <p className="muted">Under construction.</p>
    </main>
  )
}
