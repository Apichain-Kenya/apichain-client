// The last lists the server sent (apiaries, batches), per user, so the
// farmer app still shows them after an offline reload (12 §11). Same class of
// store as the outbox: this device, this user, IndexedDB. Never the access
// token, never anyone else's data.
import { openDB, type IDBPDatabase } from 'idb'

export class Snapshots {
  private db: Promise<IDBPDatabase>

  constructor(name = 'apichain-snapshots') {
    this.db = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('lists')
      },
    })
  }

  async get<T>(userId: number, key: string): Promise<T | undefined> {
    return (await (await this.db).get('lists', `${userId}:${key}`)) as T | undefined
  }

  async set(userId: number, key: string, value: unknown): Promise<void> {
    await (await this.db).put('lists', value, `${userId}:${key}`)
  }
}
