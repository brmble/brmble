import { ActiveContract, Service } from '../types';
import './ContractSlot.css';

interface ContractSlotProps {
  index: number;
  activeContract: ActiveContract | null;
  license: Service | null;
  unlocked: boolean;
  onAddContract: () => void;
  onCollect: () => void;
}

function formatVolume(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function renderStars(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function formatMoney(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(2) + 'K';
  return '$' + amount.toFixed(2);
}

export function ContractSlot({ index, activeContract, license, unlocked, onAddContract, onCollect }: ContractSlotProps) {
  if (!unlocked) {
    return (
      <div className="contract-slot locked">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="slot-locked">Locked</span>
      </div>
    );
  }

  if (!activeContract) {
    return (
      <div className="contract-slot empty">
        <span className="slot-label">Slot {index + 1}</span>
        <button className="btn btn-primary btn-sm" onClick={onAddContract}>
          + Add Contract
        </button>
      </div>
    );
  }

  const progress = (activeContract.volumeFilledBytes / activeContract.volumeBytes) * 100;
  const isComplete = progress >= 100;
  const earned = isComplete ? activeContract.volumeBytes * 0.001 : 0;

  return (
    <div className={`contract-slot active ${isComplete ? 'complete' : ''}`}>
      <div className="slot-header">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="contract-stars">{renderStars(activeContract.multiplierStars)}</span>
      </div>
      
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <span className="progress-percent">{progress.toFixed(0)}%</span>
      </div>
      
      <div className="slot-footer">
        <span className="volume-info">
          {formatVolume(activeContract.volumeFilledBytes)} / {formatVolume(activeContract.volumeBytes)}
        </span>
        {isComplete && (
          <button className="btn btn-primary btn-sm" onClick={onCollect}>
            Collect {formatMoney(earned)}
          </button>
        )}
      </div>
    </div>
  );
}
