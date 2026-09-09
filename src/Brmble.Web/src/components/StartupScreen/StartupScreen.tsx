import { BrmbleLogo } from '../Header/BrmbleLogo';
import './StartupScreen.css';

export type StartupScreenState = 'loading' | 'error';

export interface StartupScreenProps {
  state: StartupScreenState;
}

export function StartupScreen({ state }: StartupScreenProps) {
  const failed = state === 'error';

  return (
    <main
      className="startup-screen"
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="startup-screen__content">
        <BrmbleLogo size={192} className="startup-screen__logo" />
        {failed ? (
          <div className="startup-screen__message">
            <h1 className="heading-title">Brmble couldn't start</h1>
            <p>
              Please close Brmble and try again. Diagnostic details are available in{' '}
              <code>brmble-tls.log</code> in the temporary folder.
            </p>
          </div>
        ) : (
          <span className="sr-only">Brmble is starting</span>
        )}
      </div>
    </main>
  );
}
