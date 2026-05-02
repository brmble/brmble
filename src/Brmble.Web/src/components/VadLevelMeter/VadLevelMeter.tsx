import { useEffect, useState } from 'react';
import bridge from '../../bridge';
import './VadLevelMeter.css';

const MAX_RMS = 1500;

type VadMeterMessage = {
  rms: number;
  isOpen: boolean;
};

export function VadLevelMeter() {
  const [rms, setRms] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleVadMeter = (data: unknown) => {
      const msg = data as VadMeterMessage;
      setRms(msg.rms);
      setIsOpen(msg.isOpen);
    };

    bridge.send('voice.vadMeterSubscribe', { enabled: true });
    bridge.on('voice.vadMeter', handleVadMeter);

    return () => {
      bridge.send('voice.vadMeterSubscribe', { enabled: false });
      bridge.off('voice.vadMeter', handleVadMeter);
    };
  }, []);

  const fillPct = Math.min(100, (rms / MAX_RMS) * 100);
  return (
    <div className="vad-meter" aria-label="Microphone level">
      <div
        className={`vad-meter-fill ${isOpen ? 'open' : 'closed'}`}
        style={{ width: `${fillPct}%` }}
      />
    </div>
  );
}
