// One session, one outbox, one sync runner per app (12 §8).
import { Session } from '../auth/session'
import { Outbox } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'

export const session = new Session()
export const outbox = new Outbox()
export const sync = new SyncRunner(outbox, session)
