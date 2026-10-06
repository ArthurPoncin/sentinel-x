import { createBrowserRouter } from 'react-router'
import { Layout } from './layout'
import type { RouteHandle } from './layout-mode'
import { OperatorRoute } from './routes/operator'

// Two surfaces on the same feed, one per screen for the demo: the Operator view and the Digital Twin.
export const router = createBrowserRouter([
  {
    Component: Layout,
    children: [
      { index: true, Component: OperatorRoute },
      // Lazy, so three.js only ever loads on the Twin's screen. A stage: the layout gives it the whole space.
      {
        path: 'twin',
        handle: { stage: true } satisfies RouteHandle,
        lazy: async () => ({ Component: (await import('./routes/twin')).TwinRoute }),
      },
    ],
  },
])
