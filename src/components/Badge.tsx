import type { MouseEvent, ReactNode } from 'react';
import './Badge.css';

export type BadgeTone = 'accent' | 'success' | 'neutral' | 'warning';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function Badge({ tone = 'neutral', children, onClick }: BadgeProps) {
  if (onClick) {
    return (
      <button type="button" className={`badge badge--${tone} badge--clickable`} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
