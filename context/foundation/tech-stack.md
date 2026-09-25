---
starter_id: angular
package_manager: npm
project_name: frontend-subtracker
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## Why this stack

Solo developer building SubTracker after hours in 7 weeks rejected the Astro-based default because they don't know Astro and prefer Angular and NestJS, both of which they can judge an agent's output in; both starters pass all four agent-friendly gates and are bootstrapper-verified. Angular is the primary starter and must be scaffolded with SSR enabled (`--ssr`, overriding the card's `--ssr false`); a NestJS API sits beside it in `backend-subtracker`, added via `nest new`, in one repo without monorepo tooling. The API owns magic-link auth, the admin role, the subscription lifecycle state machine and scheduled jobs (`@nestjs/schedule`) for trial reminders, backed by PostgreSQL with TypeORM (chosen over Prisma). Both apps self-host on MyDevil as two Node processes on separate subdomains and ports, kept alive with `forever` and an `@reboot` cron, so CORS and a parent-domain session cookie are required. GitHub Actions uses per-directory path filters and auto-deploys on merge via rsync over SSH; since MyDevil runs FreeBSD, CI ships the build output and lockfile and runs `npm ci --omit=dev` on the server rather than copying Linux-built `node_modules`.
