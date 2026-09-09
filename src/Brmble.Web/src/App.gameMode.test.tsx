import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MainPanel } from './components/MainPanel/MainPanel';
import { overrideComponent, renderConnectedApp, resetAppHarness } from './testing/appHarness';

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

  // Chat, paint and screen share must survive a game taking the panel (UI_GUIDE
  // "Minigame Panel Pattern"), so the split is hidden as a layer rather than unmounted.
  it('keeps the split workspace mounted underneath the game surface', () => {
    render(<MainPanel {...base} mode="game" />);
    expect(screen.getByText('game surface')).toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.getByText('activity')).toBeInTheDocument();
  });

  it('takes the hidden split out of the accessibility tree and out of reach', () => {
    render(<MainPanel {...base} mode="game" />);
    const split = screen.getByText('conversation').closest('[data-main-panel-layer="split"]');
    expect(split).not.toBeNull();
    expect(split).toHaveAttribute('aria-hidden', 'true');
    expect(split).toHaveAttribute('inert');
  });

  it('exposes the split again when the panel returns to split mode', () => {
    const { rerender } = render(<MainPanel {...base} mode="game" />);
    rerender(<MainPanel {...base} mode="split" />);
    const split = screen.getByText('conversation').closest('[data-main-panel-layer="split"]');
    expect(split).not.toHaveAttribute('aria-hidden');
    expect(split).not.toHaveAttribute('inert');
  });

  it('omits the activity region entirely when there is no activity', () => {
    render(<MainPanel {...base} mode="split" activityRegion={null} />);
    expect(screen.queryByText('activity')).not.toBeInTheDocument();
    expect(screen.getByText('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});

beforeAll(() => {
  class ObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ObserverMock);
  vi.stubGlobal('IntersectionObserver', ObserverMock);
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  resetAppHarness();
  localStorage.clear();
});

// The observable consequence of unmounting the split: component-local state in the
// conversation region is destroyed. A half-typed message is the cheapest proof.
describe('starting a game does not tear down the conversation', () => {
  it('keeps a half-typed chat draft across a game opening and closing', async () => {
    const user = userEvent.setup();
    overrideComponent('Header', (props) => (
      <button type="button" onClick={props.onToggleGame as () => void}>toggle game</button>
    ));
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });

    const composer = () => screen.getByPlaceholderText('Message #General') as HTMLTextAreaElement;
    await user.type(composer(), 'half typed thought');
    expect(composer().value).toBe('half typed thought');

    await user.click(screen.getByRole('button', { name: 'toggle game' }));
    await user.click(screen.getByRole('button', { name: 'toggle game' }));

    expect(composer().value).toBe('half typed thought');
  });
});
