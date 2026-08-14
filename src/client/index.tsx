import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BtwController } from './controller.js'
import { createBtwInputSource } from './input-source.js'
import { BtwOverlay, type BtwOverlayInjected } from './overlay.js'

export const name = 'btw-client'
export const inject = ['connection', 'inputTriggers', 'sessions', 'slots']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  const sessions = ctx.get('sessions') as ISessions | undefined
  if (connection === undefined || inputTriggers === undefined || sessions === undefined) {
    throw new Error('dsh-btw/client requires connection, inputTriggers, and sessions')
  }

  const controllers = new Map<SessionId, BtwController>()
  const boundScopes = new Set<SessionId>()
  const controllerFor = (sessionId: SessionId): BtwController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new BtwController(connection, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.effect(() => inputTriggers.registerSource(createBtwInputSource(controllerFor)), 'dsh-btw: slash source')
  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    boundScopes.clear()
  }, 'dsh-btw: controller teardown')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'btw-panel',
    order: 2,
    inject: (sessionId): BtwOverlayInjected => {
      const actx = sessions.scope(sessionId)
      if (actx === undefined) throw new Error(`dsh-btw: session "${String(sessionId)}" resolved no client scope`)
      const controller = controllerFor(sessionId)
      if (!boundScopes.has(sessionId)) {
        boundScopes.add(sessionId)
        actx.effect(() => () => {
          boundScopes.delete(sessionId)
          if (controllers.get(sessionId) === controller) controllers.delete(sessionId)
          controller.dispose()
        }, 'dsh-btw: session controller')
      }
      return { controller }
    },
  }, BtwOverlay))
}
