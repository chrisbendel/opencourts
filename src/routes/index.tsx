import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main>
      <h1>OpenCourts</h1>
      <p className="lead">
        Anonymous, friction-free queue tracker for public tennis courts.
      </p>

      <div className="actions">
        <Link to="/register" className="btn btn-primary">
          Register a court
        </Link>
        <Link to="/courts" className="btn">
          Browse courts
        </Link>
      </div>
    </main>
  )
}
