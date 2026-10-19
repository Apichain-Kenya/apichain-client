import { Component, type ReactNode } from 'react'

// A lazy part that is not in the precache (the map) can fail to load: after a
// deploy, a page still running the old version asks for a chunk the server no
// longer has (P4b-H browser walk). Without a boundary React unmounts the whole
// app, update prompt included, and the screen goes blank. With one, only that
// part says it didn't load, and the rest of the form (and the update prompt,
// which brings the new version) carries on.
export class ChunkBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
