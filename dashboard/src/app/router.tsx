import { createBrowserRouter } from 'react-router'
import { Layout } from './layout'
import { OperatorRoute } from './routes/operator'

// Two surfaces on the same feed, one per screen for the demo: the Operator view and the Digital Twin.
export const router = createBrowserRouter([
  {
    Component: Layout,
    children: [
      { index: true, Component: OperatorRoute },
      // Lazy, so three.js only ever loads on the Twin's screen.
      { path: 'twin', lazy: async () => ({ Component: (await import('./routes/twin')).TwinRoute }) },
    ],
  },
])
