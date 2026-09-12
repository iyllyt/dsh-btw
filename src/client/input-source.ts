import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CommandClaim,
  InputTriggerSource,
  PickOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { BtwController } from './controller.js'

export type BtwControllerFor = (sessionId: SessionId) => BtwController

function claim(controller: BtwController, commandToken = '/btw'): CommandClaim {
  return {
    token: `${commandToken} `,
    hint: '<your question>',
    submit: args => controller.ask(args),
  }
}

function enterClaim(controllerFor: BtwControllerFor, sessionId: SessionId, line: string): PickOutcome {
  const match = /^\s*(\/btw)\b/iu.exec(line)
  if (match?.[1] === undefined) return undefined
  return { claim: claim(controllerFor(sessionId), match[1]) }
}

export function createBtwInputSource(controllerFor: BtwControllerFor): InputTriggerSource {
  return {
    trigger: '/',
    name: 'btw',
    order: -10,
    candidates(_session, request) {
      if (request.position !== 'leading' || !'btw'.startsWith(request.query.toLowerCase())) return Promise.resolve([])
      return Promise.resolve([{
        name: 'btw',
        description: 'Ask a side question without interrupting the main agent',
        hint: '<your question>',
      }])
    },
    onPick(pick) {
      return { claim: claim(controllerFor(pick.session.sessionId)) }
    },
    matchSpace(session, token) {
      return /^\/btw$/iu.test(token)
        ? { claim: claim(controllerFor(session.sessionId), token) }
        : undefined
    },
    matchEnter(session, line) {
      return Promise.resolve(enterClaim(controllerFor, session.sessionId, line))
    },
  }
}
