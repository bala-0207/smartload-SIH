import { NavLink } from 'react-router-dom';

/**
 * Thin header. Wagon ID and timestamp — the two things that identify what you
 * are looking at — plus route switching. Nothing else lives here.
 */
interface Props {
  wagonId: string;
  timestamp: string | null;
}

export function AppHeader({ wagonId, timestamp }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/40 bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-8 lg:px-12">
        <span className="tabular shrink-0 text-xs font-semibold tracking-[0.1em] text-foreground sm:text-sm">
          {wagonId}
        </span>
        <span
          className="tabular hidden text-xs text-foreground/60 sm:inline"
          aria-label="Frame timestamp"
        >
          {timestamp ? timestamp.replace('T', ' ') : '—'}
        </span>

        {/* Three links have to fit beside the wagon id on a 375px phone, so the
            chrome tightens at the base breakpoint rather than wrapping — a
            wrapped header would push the console's first element down. */}
        <nav className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <HeaderLink to="/operator">Operator</HeaderLink>
          <HeaderLink to="/simulator">Simulator</HeaderLink>
          <HeaderLink to="/demo">Demo</HeaderLink>
        </nav>
      </div>
    </header>
  );
}

function HeaderLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]',
          'sm:px-3 sm:text-xs sm:tracking-[0.12em]',
          'transition-colors duration-200',
          isActive ? 'bg-secondary text-foreground' : 'text-foreground/60 hover:text-foreground',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}
