// Texts effort-guard hands to the model: pure, so they are tested on their own.

// What a compaction should keep: the command that kept failing, the narrow
// rerun and the files changed recently. Null when there is nothing to add.
export function buildCompactHint(m) {
  if (!m) {
    return null
  }

  const lines = []
  if (m.consecutiveStruggles > 0 && m.lastStruggleCommand) {
    lines.push(
      `The last ${m.consecutiveStruggles} turn(s) failed (${m.lastStruggleReason ?? 'failure'}) on: ${m.lastStruggleCommand}. Keep that command, the error it printed and what was already tried.`,
    )
  }
  if (m.rerunHint) {
    lines.push(`Narrow rerun for the failing tests: ${m.rerunHint}`)
  }
  if (Array.isArray(m.touchedFiles) && m.touchedFiles.length > 0) {
    lines.push(`Files changed recently, keep their paths: ${m.touchedFiles.join(', ')}`)
  }

  return lines.length > 0 ? `effort-guard:\n- ${lines.join('\n- ')}` : null
}

// Appends the hint to what the person asked /compact to stress, if anything.
export function withCompactHint(instructions, hint) {
  if (!hint) {
    return instructions
  }

  return instructions ? `${instructions}\n\n${hint}` : hint
}

// One line for the model, appended to the result of a failed command: the
// narrow rerun, and at the streak threshold what to do before the next try.
// Nothing the model cannot act on (no "raise effort", no "switch model").
export function buildToolHint({ command, rerun, streak }) {
  const lines = []
  if (rerun) {
    lines.push(`to rerun only the failing tests: ${rerun}`)
  }
  if (streak > 0) {
    lines.push(
      `${streak} turns in a row failed${command ? ` on ${command}` : ''}. Before the next attempt, reread the first error, write down a hypothesis and change approach; if it does not converge, stop and ask.`,
    )
  }

  return lines.length > 0 ? `effort-guard: ${lines.join(' ')}` : null
}
