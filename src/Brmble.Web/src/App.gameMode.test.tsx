import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainPanel } from './components/MainPanel/MainPanel';

// MainPanel is the extracted render decision; App composes it.
describe('main panel game mode', () => {
  const base = {
    activityRegion: <div>activity</div>,
    conversationRegion: <div>conversation</div>,
    gameSurface: <div>game surface</div>,
  };

  it('renders the split layout when not playing', () => {
    render(<MainPanel {...base} mode="split" />);
    expect(screen.getByText('activity')).toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.queryByText('game surface')).not.toBeInTheDocument();
  });

  it('renders only the game surface when playing', () => {
    render(<MainPanel {...base} mode="game" />);
    expect(screen.getByText('game surface')).toBeInTheDocument();
    expect(screen.queryByText('activity')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation')).not.toBeInTheDocument();
  });

  it('omits the activity region entirely when there is no activity', () => {
    render(<MainPanel {...base} mode="split" activityRegion={null} />);
    expect(screen.queryByText('activity')).not.toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});
