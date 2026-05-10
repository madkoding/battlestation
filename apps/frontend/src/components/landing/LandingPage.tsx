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
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#11213d_0%,transparent_45%),radial-gradient(circle_at_90%_20%,#0f2f2a_0%,transparent_40%),linear-gradient(160deg,#070b14_0%,#0b1020_60%,#0a0f1d_100%)] text-white">
      <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-14 md:px-10 md:pt-20">
        <div className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
          Project Name: Battlestation
        </div>

        <h1 className="mt-8 max-w-5xl text-4xl font-semibold leading-tight md:text-7xl">
          BATTLESTATION
          <span className="mt-3 block text-2xl font-medium text-slate-200 md:text-4xl">
            Multi-agent task orchestration platform
          </span>
        </h1>

        <p className="mt-6 max-w-4xl text-base text-slate-300 md:text-lg">
          Battlestation is the product name of this system. It combines a deterministic task workflow, autonomous agents, and realtime APIs so teams can plan, implement, review, and close work with explicit accountability at each stage.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <a
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-200/50 bg-cyan-300/15 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
            href="https://github.com/madkoding/battlestation"
            target="_blank"
            rel="noreferrer"
          >
            View Repository <ArrowRight className="h-4 w-4" />
          </a>
          <a
            className="inline-flex items-center gap-2 rounded-xl border border-slate-400/40 bg-slate-200/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-200/10"
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
              className="rounded-2xl border border-slate-200/10 bg-slate-200/5 p-6 backdrop-blur"
            >
              <item.icon className="h-8 w-8 text-cyan-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-100">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.description}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-cyan-100">How agents operate in Battlestation</h3>
          <p className="mt-3 text-sm leading-relaxed text-cyan-50/85 md:text-base">
            The platform runs a role-based multi-agent model where each agent owns a specific responsibility.
            This prevents overlap and keeps transitions auditable.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {agentCards.map((agent) => (
              <article key={agent.name} className="rounded-xl border border-cyan-100/20 bg-slate-900/45 p-4">
                <agent.icon className="h-6 w-6 text-cyan-300" />
                <h4 className="mt-3 text-lg font-semibold text-slate-100">{agent.name}</h4>
                <p className="text-xs uppercase tracking-wider text-cyan-200">{agent.role}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{agent.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-amber-100">How tasks move through the system</h3>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {flowSteps.map((step) => (
              <div key={step.status} className="rounded-xl border border-amber-100/25 bg-slate-900/45 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200">{step.status}</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">Owner: {step.owner}</p>
                <p className="mt-2 text-sm text-slate-300">{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-indigo-300/20 bg-indigo-300/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-indigo-100">Application Screenshots</h3>
          <p className="mt-3 text-sm leading-relaxed text-indigo-50/85 md:text-base">
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
                className="overflow-hidden rounded-xl border border-indigo-100/25 bg-slate-900/50"
              >
                <img
                  src={shot.src}
                  alt={shot.title}
                  className="h-56 w-full object-cover object-top transition duration-300 hover:scale-[1.02]"
                  loading="lazy"
                />
                <figcaption className="border-t border-indigo-100/20 px-4 py-3 text-sm text-slate-200">
                  {shot.title}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-6 md:p-8">
          <h3 className="text-xl font-semibold text-emerald-100">Why teams adopt it</h3>
          <ul className="mt-5 space-y-3 text-sm text-emerald-50/90">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              Explicit role boundaries: orchestrator, developer, and QA agents.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              Human approval gates before final release transitions.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              Portable architecture with backend API and frontend dashboard in one stack.
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}
