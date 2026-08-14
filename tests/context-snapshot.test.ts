import { CallId, createAssistantMessage, createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { balancedMessagePrefix, wrapQuestion } from '../src/host/context-snapshot.js'

const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (content: Message['content']) => createAssistantMessage({
  content,
  source: { provider: 'mock', model: 'mock' },
})

describe('context snapshot', () => {
  it('keeps the active user message when the main agent is busy', () => {
    const messages = [user('old'), assistant([{ type: 'text', text: 'answer' }]), user('BUSY-4821')]
    expect(balancedMessagePrefix(messages)).toEqual(messages)
  })

  it('backs off an unfinished tool-call tail', () => {
    const safe = [user('question'), assistant([{ type: 'text', text: 'answer' }]), user('next')]
    const messages = [...safe, assistant([{
      type: 'tool-call',
      id: CallId('call-1'),
      name: 'bash',
      arguments: '{}',
    }])]
    expect(balancedMessagePrefix(messages)).toEqual(safe)
  })

  it('uses Claude Code compatible one-shot constraints without a persona override', () => {
    const wrapped = wrapQuestion('what is the secret?')
    expect(wrapped).toContain('The main agent is NOT interrupted')
    expect(wrapped).toContain('You have NO tools available')
    expect(wrapped).toContain('what is the secret?')
  })
})
