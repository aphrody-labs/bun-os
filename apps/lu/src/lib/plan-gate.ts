/**
 * When the agent is allowed to keep a todo list at all.
 *
 * The prompt used to tell the model to open a plan for anything longer than
 * three steps and to resend the complete list after EVERY step. On an open
 * model that is a separate round trip per tick, each one sending the full
 * context again, and the user never asked for a plan in the first place.
 *
 * So planning is opt-in. todo_write is offered when
 *   - the conversation runs in Plan mode, or
 *   - the user's own message asks for a plan, a todo or checklist, or
 *   - the conversation already holds an open plan that has to be kept current.
 * Everywhere else it is not in the tool list, and the model just works.
 */
import { openPlanGap } from './plan-reconcile'
import type { TodoItem } from '../stores/todoStore'

export const PLAN_TOOL = 'todo_write'

/**
 * The user asked for a plan in so many words. Deliberately narrow: "fix the
 * build steps" or "the plan field in the form" must not turn planning on, so
 * the words have to be about THIS task being planned.
 */
const PLAN_REQUEST = new RegExp(
  [
    // English
    String.raw`\b(?:make|write|create|draft|give me|show me|start with|with)\s+(?:me\s+)?(?:a|the|your)\s+(?:short\s+|detailed\s+|step[- ]by[- ]step\s+)?(?:plan|todo(?:\s+list)?|to-do(?:\s+list)?|checklist)\b`,
    String.raw`\bplan\s+(?:it|this|that|the (?:work|task|steps|change|refactor|migration))\b`,
    String.raw`\b(?:todo|to-do)\s+list\b`,
    String.raw`\bstep[- ]by[- ]step\b`,
    String.raw`\bplan (?:first|before)\b`,
    // Deutsch
    String.raw`\b(?:mach|erstell|schreib|zeig|gib)\w*\s+(?:mir\s+)?(?:einen|den|eine|die)\s+(?:kurzen\s+|genauen\s+)?(?:plan|todo-?liste|to-do-liste|checkliste)\b`,
    String.raw`\bplane?\s+(?:das|es|die (?:arbeit|aufgabe|schritte))\b`,
    String.raw`\bschritt f(?:ü|ue)r schritt\b`,
    String.raw`\berst(?:mal)? (?:einen )?plan\b`,
    String.raw`\btodo-?liste\b`,
  ].join('|'),
  'i',
)

export function userAskedForPlan(text: string): boolean {
  return PLAN_REQUEST.test(text)
}

export interface PlanToolInput {
  /** Coding-agent preset of this run, null on surfaces without one. */
  mode: string | null
  /** The user's own words for this turn. */
  userText: string
  /** The conversation's current todo list. */
  todos: TodoItem[]
}

export function planToolAllowed(input: PlanToolInput): boolean {
  if (input.mode === 'plan') return true
  if (userAskedForPlan(input.userText)) return true
  return openPlanGap(input.todos) !== null
}

/** Drop todo_write from an offered catalog unless planning is allowed. */
export function gatePlanTool<T extends { name: string }>(defs: T[], allowed: boolean): T[] {
  return allowed ? defs : defs.filter((d) => d.name !== PLAN_TOOL)
}
