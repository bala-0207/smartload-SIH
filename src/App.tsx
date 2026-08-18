import { Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Operator } from './routes/Operator';
import { Simulator } from './routes/Simulator';
import { Demo } from './routes/Demo';

/**
 * Three routes, all reading one telemetry store:
 *   /operator   what hangs in the cab — the product
 *   /simulator  what proves the physics behind it
 *   /demo       both at once, on one stage, for a room of judges
 *
 * There is no landing page — this is an industrial console, and the first
 * screen is a console.
 *
 * `/` and every unmatched path land on /demo: the combined stage is what gets
 * presented, so it is what should open. /operator remains the shippable
 * product and is unchanged — it is simply no longer the landing.
 */
export default function App() {
  return (
    // reducedMotion="user" makes framer-motion honour the OS setting for
    // transforms; components additionally collapse their own choreography via
    // useReducedMotion so information stays visible rather than disappearing.
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route path="/" element={<Navigate to="/demo" replace />} />
        <Route path="/operator" element={<Operator />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="*" element={<Navigate to="/demo" replace />} />
      </Routes>
    </MotionConfig>
  );
}
