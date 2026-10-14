// Claude advisor dispatch guard.
//
// Stateless OpenCode plugin registering a single tool.execute.before hook with
// two fail-fast checkpoints in front of the external claude advisor:
//   1. task with args.subagent_type === "claude": args.prompt and
//      args.description must be non-empty printable ASCII (tab/LF/CR allowed),
//      prompt <= 8192 bytes, description <= 160 bytes.
//   2. acp_run with args.agent === "claude": args.prompt gets the same ASCII
//      and 8192-byte rules, and the call may carry exactly the keys
//      {agent, prompt}; anything else (cwd, timeout_ms, ...) is rejected.
//
// Deliberately out of scope: file/board content checks, language detection,
// task<->acp_run consistency checks, persisted state, retries/transliteration.
// Node builtins only; no absolute filesystem paths; no third-party deps.

const PRINTABLE_ASCII = /^[\x09\x0A\x0D\x20-\x7E]+$/
const PROMPT_MAX_BYTES = 8192
const DESCRIPTION_MAX_BYTES = 160

function reject(rule) {
  throw new Error(`Claude dispatch rejected: ${rule}`)
}

function checkAsciiField(field, label, maxBytes) {
  if (typeof field !== "string" || field.trim() === "") {
    reject(`${label} must be non-empty printable ASCII text.`)
  }
  if (!PRINTABLE_ASCII.test(field)) {
    reject(
      `${label} must contain printable ASCII text, tabs, or line breaks only. ` +
        `Put supporting material in project files and reference it using ASCII relative paths.`
    )
  }
  const bytes = Buffer.byteLength(field, "utf8")
  if (bytes > maxBytes) {
    reject(`${label} is ${bytes} bytes; the limit is ${maxBytes} bytes.`)
  }
}

export const ClaudeAdvisorGuard = async () => ({
  "tool.execute.before": async (input, output) => {
    const tool = input?.tool
    const args = output?.args ?? input?.args
    if (!args || typeof args !== "object") return

    if (tool === "task" && args.subagent_type === "claude") {
      checkAsciiField(args.prompt, "task prompt", PROMPT_MAX_BYTES)
      checkAsciiField(args.description, "task description", DESCRIPTION_MAX_BYTES)
      return
    }

    if (tool === "acp_run" && args.agent === "claude") {
      for (const key of Object.keys(args)) {
        if (key !== "agent" && key !== "prompt") {
          reject(`acp_run for claude accepts only the "agent" and "prompt" parameters; "${key}" is not allowed.`)
        }
      }
      checkAsciiField(args.prompt, "acp_run prompt", PROMPT_MAX_BYTES)
    }
  },
})

export default ClaudeAdvisorGuard
