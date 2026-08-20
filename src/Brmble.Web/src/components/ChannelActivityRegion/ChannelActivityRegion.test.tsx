import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChannelActivityRegion } from './ChannelActivityRegion';

const activities = [
  { kind: 'screen-share' as const, label: 'Screen share' },
  { kind: 'paint' as const, label: 'Paint' },
];

describe('ChannelActivityRegion', () => {
  it('names the channel and lists every live activity', () => {
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={vi.fn()}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    expect(screen.getByRole('region', { name: 'General activity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Screen share' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('stage content')).toBeInTheDocument();
  });

  it('reports an explicit selection', () => {
    const onSelect = vi.fn();
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={onSelect}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Paint' }));
    expect(onSelect).toHaveBeenCalledWith('paint');
  });

  it('renders a single chip without a switcher affordance disappearing', () => {
    render(
      <ChannelActivityRegion channelName="General" activities={[activities[0]]} stage="screen-share" onSelect={vi.fn()}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('moves between chips with the arrow keys', () => {
    const onSelect = vi.fn();
    render(
      <ChannelActivityRegion channelName="General" activities={activities} stage="screen-share" onSelect={onSelect}>
        <div>stage content</div>
      </ChannelActivityRegion>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Screen share' }), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('paint');
  });
});
