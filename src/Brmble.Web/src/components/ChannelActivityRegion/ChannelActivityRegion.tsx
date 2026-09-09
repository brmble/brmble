import type { ReactNode } from 'react';
import type { ChannelActivityKind } from '../../workspace/channelActivity';
import styles from './ChannelActivityRegion.module.css';

interface ChannelActivityRegionProps {
  channelName: string;
  activities: { kind: ChannelActivityKind; label: string }[];
  stage: ChannelActivityKind | null;
  onSelect: (kind: ChannelActivityKind) => void;
  children: ReactNode;
}

export function ChannelActivityRegion({
  channelName,
  activities,
  stage,
  onSelect,
  children,
}: ChannelActivityRegionProps) {
  const move = (index: number, delta: number) => {
    const next = activities[(index + delta + activities.length) % activities.length];
    if (next) onSelect(next.kind);
  };

  return (
    <section className={styles.region} aria-label={`${channelName} activity`}>
      <header className={styles.header}>
        <span className={styles.channelName}>{channelName}</span>
        <div className={styles.chips} role="tablist" aria-label="Channel activities">
          {activities.map((activity, index) => (
            <button
              key={activity.kind}
              type="button"
              role="tab"
              aria-selected={stage === activity.kind}
              tabIndex={stage === activity.kind ? 0 : -1}
              className={`${styles.chip} ${stage === activity.kind ? styles.chipActive : ''}`}
              onClick={() => onSelect(activity.kind)}
              onKeyDown={event => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(index, 1);
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
            >
              {activity.label}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.stage}>{children}</div>
    </section>
  );
}
