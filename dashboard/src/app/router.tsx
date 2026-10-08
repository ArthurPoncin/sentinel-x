import { createBrowserRouter } from 'react-router'
import { TUTORIAL } from './app-sidebar'
import { Layout } from './layout'
import type { RouteHandle } from './layout-mode'
import { OperatorRoute } from './routes/operator'
import { TutorialRoute } from './routes/tutorial'

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
      // The hand control's tutorial: in the menu only while the hand control is on.
      { path: TUTORIAL.slice(1), Component: TutorialRoute },
    ],
  },
])
