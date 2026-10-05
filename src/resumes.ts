// The runs the focus view's redirect resumed, as plain data. A redirect to
// an ended agent resumes it through the mod's own `$.session.send`, so that
// run's turn.step and tool.call skip the mod's hooks (AGENTS.md, "The run a
// redirect resumes"). The focus view (src/focus.tsx) marks the agent and
// fills its feed from the rows of its conversation meanwhile; the agent
// tracker (src/agents.ts) wakes its squishy on them, and forgets the mark
// once the agent ends or the session is rebuilt. A reload forgets it all.

/** What a redirect says before the user's words, so the agent reads it as theirs. */
const FROM_USER = 'Message from your user, typed into the squishys focus view (not from another agent or the coordinator): '

/** A redirect as the agent reads it: from its user, never from another agent or the coordinator. */
export function fromUser(text: string): string {
  return FROM_USER + text
}

/**
 * Whether a row's blocks carry a redirect: Claude Code puts its own words
 * before the message it delivers ("The coordinator sent a message while
 * you were working:", seen in a session for #60), so anywhere in a text block.
 */
export function carriesRedirect(content: readonly { type: string; [field: string]: unknown }[]): boolean {
  return content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.includes(FROM_USER))
}

/** The agents whose run a redirect resumed, until that run ends. */
const marked = new Set<string>()

/** A redirect is resuming this agent; marked before the send, which may start the run before it answers. */
export function markResumed(agentId: string): void {
  marked.add(agentId)
}

/** Whether the run this agent is on is one a redirect resumed. */
export function isResumedByRedirect(agentId: string): boolean {
  return marked.has(agentId)
}

/** This agent's resumed run is over, or never started (a send that wasn't delivered). */
export function forgetResumed(agentId: string): void {
  marked.delete(agentId)
}

/** A rebuilt session (/clear, /resume, a branch): no run is a redirect's. */
export function forgetResumes(): void {
  marked.clear()
}
