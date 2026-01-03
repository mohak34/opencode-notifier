export interface SessionInfo {
  title: string
  parentID?: string
}

export class SessionCache {
  private cache = new Map<string, SessionInfo>()

  set(id: string, info: SessionInfo): void {
    this.cache.set(id, info)
  }

  get(id: string): SessionInfo | undefined {
    return this.cache.get(id)
  }

  has(id: string): boolean {
    return this.cache.has(id)
  }

  clear(): void {
    this.cache.clear()
  }
}

export const sessionCache = new SessionCache()
