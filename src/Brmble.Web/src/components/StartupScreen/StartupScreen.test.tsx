import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StartupScreen } from './StartupScreen';

describe('StartupScreen', () => {
  it('renders an accessible loading state with a static logo', () => {
    const { container } = render(<StartupScreen state="loading" />);

    expect(screen.getByRole('status')).toHaveTextContent('Brmble is starting');
    expect(container.querySelector('.brmble-logo-heartbeat')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an accessible startup failure message without the heartbeat logo', () => {
    const { container } = render(<StartupScreen state="error" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Brmble couldn't start" })).toBeInTheDocument();
    expect(screen.getByText(/close Brmble and try again/i)).toBeInTheDocument();
    expect(container.querySelector('.brmble-logo-heartbeat')).not.toBeInTheDocument();
  });
});
