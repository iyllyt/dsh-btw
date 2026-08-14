import { createUserMessage, type Message, type ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

export const BTW_REMINDER = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>`

export interface BtwContextSnapshot {
  readonly parentSessionId: string
  readonly config: LlmCallConfig
  readonly system?: string
  readonly tools?: ToolSchema[]
  readonly sharedMessages: Message[]
  readonly messages: Message[]
}

/** Longest prefix that does not leave an assistant tool call without its result. */
export function balancedMessagePrefix(messages: readonly Message[]): Message[] {
  const pending = new Set<string>()
  let lastBalanced = 0
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message === undefined) continue
    for (const block of message.content) {
      if (message.role === 'assistant' && block.type === 'tool-call') pending.add(String(block.id))
      if (message.role === 'user' && block.type === 'tool-result') pending.delete(String(block.toolCallId))
    }
    if (pending.size === 0) lastBalanced = index + 1
  }
  return messages.slice(0, lastBalanced)
}

export function wrapQuestion(question: string): string {
  return `${BTW_REMINDER}\n\n${question}`
}

export function snapshotContext(agent: Agent, question: string): BtwContextSnapshot {
  const header = agent.session.requestHeader()
  if (header === undefined) {
    throw new Error('No model request context exists yet. Send one main-conversation message before using /btw.')
  }
  const sharedMessages = balancedMessagePrefix(agent.session.deriveMessages())
  const sideQuestion = createUserMessage({
    content: [{ type: 'text', text: wrapQuestion(question) }],
    source: { kind: 'user' },
  })
  return {
    parentSessionId: String(agent.session.id),
    config: structuredClone(header.config),
    ...(header.system === undefined ? {} : { system: header.system }),
    ...(header.tools === undefined ? {} : { tools: structuredClone(header.tools) }),
    sharedMessages,
    messages: [...sharedMessages, sideQuestion],
  }
}
