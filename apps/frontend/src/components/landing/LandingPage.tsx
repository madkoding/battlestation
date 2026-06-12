import { ArrowRight, CheckCircle2, Globe, Layers, Radio, ShieldCheck, Wrench, Cpu } from 'lucide-react'
import { useMemo } from 'react'
import { useAgentStore } from '@/stores/agentStore'

const features = [
  {
    icon: Layers,
    title: 'Workflow Engine',
    description: 'Deterministic task flow from todo to done with role-based transitions.',
  },
  {
    icon: Radio,
    title: 'Live Activity',
    description: 'Real-time updates through WebSocket events and activity streams.',
  },
  {
    icon: Globe,
    title: 'API First',
    description: 'REST endpoints for projects, tasks, comments, approvals, and metrics.',
  },
]

const agents = [
  {
    icon: Cpu,
    name: 'Kosmos',
    role: 'Orchestrator',
    description:
      'Breaks down work, routes tasks to the right specialist, and enforces workflow decisions.',
  },
  {
    icon: Wrench,
    name: 'Vicks',
    role: 'Developer',
    description:
      'Implements features and fixes, then transitions tasks to QA with implementation context.',
  },
  {
    icon: ShieldCheck,
    name: 'Wedge',
    role: 'QA Engineer',
    description:
      'Validates behavior and quality gates, approves or rejects with actionable feedback.',
  },
]

export function LandingPage() {
  const base = import.meta.env.BASE_URL || '/'
  const profiles = useAgentStore((state) => state.profiles)
  const workflow = useAgentStore((state) => state.workflow)

  const agentCards = useMemo(() => {
    if (!profiles.length) return agents
    return profiles.map((profile) => {
      const role = String(profile.role || '').toLowerCase()
      const icon = role.includes('qa') ? ShieldCheck : role.includes('developer') || role.includes('engineer') ? Wrench : Cpu
      return {
        icon,
        name: profile.name,
        role: profile.role || 'Specialist',
        description: `${profile.name} profile loaded from agent configuration.`,
      }
    })
  }, [profiles])

  const flowSteps = useMemo(
    () => [
      { status: 'todo', owner: workflow.status_owners.todo || 'Orchestrator Agent', text: 'Task prepared and scoped.' },
      { status: 'progress', owner: workflow.status_owners.progress || 'Developer Agent', text: 'Implementation in active development.' },
      { status: 'qa', owner: workflow.status_owners.qa || 'QA Agent', text: 'Quality checks and validation.' },
      { status: 'done', owner: workflow.status_owners.done || 'Orchestrator Agent', text: 'Approved and formally closed.' },
    ],
    [workflow.status_owners]
  )

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary"
      style={{
        backgroundImage: 'radial-gradient(circle at 10% 10%, rgba(17,33,61,0.8) 0%, transparent 45%), radial-gradient(circle at 90% 20%, rgba(15,47,42,0.6) 0%, transparent 40%), linear-gradient(160deg, var(--color-bg-primary) 0%, var(--color-bg-card) 60%, var(--color-bg-primary) 100%)'
      }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-14 md:px-10 md:pt-20">
        <div className="inline-flex items-center rounded-full border border-accent-primary/35 bg-accent-primary/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-primary">
          Project Name: Battlestation
        </div>

        <h1 className="mt-8 max-w-5xl text-4xl font-semibold leading-tight md:text-7xl">
          BATTLESTATION
          <span className="mt-3 block text-2xl font-medium text-text-secondary md:text-4xl">
            Multi-agent task orchestration platform
          </span>
        </h1>

        <p className="mt-6 max-w-4xl text-base text-text-secondary md:text-lg">
          Battlestation is the product name of this system. It combines a deterministic task workflow, autonomous agents, and realtime APIs so teams can plan, implement, review, and close work with explicit accountability at each stage.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <a
            className="inline-flex items-center gap-2 rounded-xl border border-accent-primary/50 bg-accent-primary/15 px-5 py-3 text-sm font-semibold text-text-inverse transition hover:bg-accent-primary/25"
            href="https://github.com/madkoding/battlestation"
            target="_blank"
            rel="noreferrer"
          >
            View Repository <ArrowRight className="h-4 w-4" />
          </a>
          <a
            className="inline-flex items-center gap-2 rounded-xl border border-border-default/40 bg-surface-default/5 px-5 py-3 text-sm font-semibold text-text-primary transition hover:bg-surface-hover/10"
            href="https://github.com/madkoding/battlestation#quick-start"
            target="_blank"
            rel="noreferrer"
          >
            Quick Start
          </a>
        </div>

        <section className="mt-16 grid gap-5 md:grid-cols-3">
          {features.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-border-default/10 bg-surface-default/5 p-6 backdrop-blur"
            >
              <item.icon className="h-8 w-8 text-accent-primary" />
              <h2 className="mt-4 text-lg font-semibold text-text-primary">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{item.description}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-2xl border border-accent-primary/20 bg-accent-primary/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-text-primary">How agents operate in Battlestation</h3>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary md:text-base">
            The platform runs a role-based multi-agent model where each agent owns a specific responsibility.
            This prevents overlap and keeps transitions auditable.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {agentCards.map((agent) => (
              <article key={agent.name} className="rounded-xl border border-accent-primary/20 bg-bg-card/45 p-4">
                <agent.icon className="h-6 w-6 text-accent-primary" />
                <h4 className="mt-3 text-lg font-semibold text-text-primary">{agent.name}</h4>
                <p className="text-xs uppercase tracking-wider text-accent-primary">{agent.role}</p>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{agent.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-status-progress/25 bg-status-progress/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-text-primary">How tasks move through the system</h3>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {flowSteps.map((step) => (
              <div key={step.status} className="rounded-xl border border-status-progress/25 bg-bg-card/45 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-status-progress">{step.status}</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">Owner: {step.owner}</p>
                <p className="mt-2 text-sm text-text-secondary">{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-status-qa/20 bg-status-qa/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-text-primary">Application Screenshots</h3>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary md:text-base">
            Real views from the running application: dashboard, Kanban board, task modal, and live activity stream.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              { src: `${base}screenshots/01-dashboard-overview.png`, title: 'Dashboard Overview' },
              { src: `${base}screenshots/02-kanban-board.png`, title: 'Kanban Board' },
              { src: `${base}screenshots/03-task-modal.png`, title: 'Task Modal' },
              { src: `${base}screenshots/04-live-activity.png`, title: 'Live Activity' },
            ].map((shot) => (
              <figure
                key={shot.src}
                className="overflow-hidden rounded-xl border border-status-qa/25 bg-bg-card/50"
              >
                <img
                  src={shot.src}
                  alt={shot.title}
                  className="h-56 w-full object-cover object-top transition duration-300 hover:scale-[1.02]"
                  loading="lazy"
                />
                <figcaption className="border-t border-status-qa/20 px-4 py-3 text-sm text-text-secondary">
                  {shot.title}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-status-done/20 bg-status-done/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-text-primary">Why teams adopt it</h3>
          <ul className="mt-5 space-y-3 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-done" />
              Explicit role boundaries: orchestrator, developer, and QA agents.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-done" />
              Human approval gates before final release transitions.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-done" />
              Portable architecture with backend API and frontend dashboard in one stack.
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}
