/**
 * THE OPERATOR'S SENTENCE — one implementation, one place.
 *
 * Derived from the published contract alone: `next_best_action` plus
 * `explanation`. That constraint is deliberate. Real edge hardware publishes
 * the contract and nothing else, so if the sentence needed anything beyond it
 * the console could not be driven by real hardware without a UI change — which
 * is exactly the coupling the data contract exists to prevent.
 *
 * CONVENTION, relied on here and upheld in recommend.ts:
 *   explanation[0] is always the primary quantitative justification for the
 *   recommended action. Everything after it is secondary context.
 */

import type { NextBestAction } from './telemetry';

/**
 * First number in a string, as written — INCLUDING a leading `<` or `>`.
 *
 * The recommendation layer saturates risk percentages it will not state as
 * certainties, emitting "<1" and ">99" rather than a bare 0 or 100. Matching
 * only the digits would strip the qualifier and turn "<1% overload risk" back
 * into "1% OVERLOAD RISK" on the console — quietly undoing the clamp at the
 * last step, and reintroducing exactly the false precision it exists to
 * prevent. The qualifier is part of the number.
 */
function firstNumber(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/([<>]?\d[\d,]*)/);
  return m ? m[1] : null;
}

export function actionHeadline(
  action: NextBestAction,
  explanation: string[],
): string {
  const primary = explanation[0];
  const n = firstNumber(primary);
  const risk = n ? ` - ${n}% OVERLOAD RISK` : '';

  switch (action) {
    case 'ONE_MORE_FULL_BUCKET':
      return `ONE MORE FULL BUCKET${risk}`;
    case 'TWO_MORE_FULL_BUCKETS':
      return `TWO MORE FULL BUCKETS${risk}`;
    case 'THREE_MORE_FULL_BUCKETS':
      return `THREE MORE FULL BUCKETS${risk}`;
    case 'HALF_BUCKET':
      return `HALF BUCKET${risk}`;

    case 'NEXT_BUCKET_LEFT':
      return n ? `NEXT BUCKET LEFT - ${n}% ON RIGHT RAIL` : 'NEXT BUCKET LEFT';
    case 'NEXT_BUCKET_RIGHT':
      return n ? `NEXT BUCKET RIGHT - ${n}% ON LEFT RAIL` : 'NEXT BUCKET RIGHT';

    case 'STOP':
      // Two distinct stops: already over the limit, or predicted to go over.
      if (primary && /over limit/i.test(primary)) return `STOP - ${n} KG OVER LIMIT`;
      return `STOP - NEXT BUCKET${risk ? risk.replace(' - ', ' ') : ''}`;

    case 'HOLD_SENSOR_FAULT':
      if (primary && /load cell/i.test(primary)) return 'HOLD - LOAD CELL FAULT';
      return 'HOLD - SENSOR FAULT';

    case 'COMPLETE':
      return 'LOADING COMPLETE';

    case 'AWAITING_WAGON':
    default:
      return 'AWAITING WAGON';
  }
}
