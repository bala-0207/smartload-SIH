import { motion } from 'framer-motion';
import { SCENARIO_LIST, type ScenarioId } from '../lib/scenarios';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * SCENARIO TRIGGERS.
 *
 * Each button rebuilds the physics engine with different underlying conditions
 * — bucket mass distribution, operator side bias, dust attenuation, uplink
 * state. None of them force a status colour directly; the colour is whatever
 * the estimator concludes from the changed physics.
 */

interface Props {
  active: ScenarioId;
  onSelect: (id: ScenarioId) => void;
  /**
   * Tighter scale for /demo, where all six must sit on ONE row in the right
   * column. A strip that wraps to two rows is a grid, and it eats the vertical
   * budget the curve needs.
   */
  compact?: boolean;
}

export function ScenarioTriggers({ active, onSelect, compact = false }: Props) {
  const reduced = useReducedMotion();

  return (
    <div className={compact ? 'flex flex-nowrap gap-1.5' : 'flex flex-wrap gap-2'}>
      {SCENARIO_LIST.map((s) => {
        const isActive = s.id === active;
        return (
          <motion.button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            title={s.note}
            aria-pressed={isActive}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            className={[
              'cursor-pointer rounded-lg border text-left whitespace-nowrap',
              'transition-colors duration-200',
              compact
                ? 'px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.06em]'
                : 'px-4 py-2.5 text-[13px] font-semibold uppercase tracking-[0.08em]',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border/60 bg-muted text-foreground/70 hover:border-border hover:text-foreground',
            ].join(' ')}
          >
            {s.label}
          </motion.button>
        );
      })}
    </div>
  );
}
