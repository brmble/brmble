import { Contract } from '../types';
import './ContractPopup.css';

interface ContractPopupProps {
  contracts: Contract[];
  onSelect: (contract: Contract) => void;
  onClose: () => void;
}

function formatVolume(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function getTimeRange(stars: number): string {
  switch (stars) {
    case 5: return '± 3-5 min';
    case 4: return '± 4-6 min';
    default: return '± 6-9 min';
  }
}

function renderStars(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

export function ContractPopup({ contracts, onSelect, onClose }: ContractPopupProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prompt glass-panel animate-slide-up contract-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Select Contract</h2>
          <p className="modal-subtitle">Choose a contract to assign to a license</p>
        </div>
        
        <div className="modal-body">
          <div className="contract-grid">
            {contracts.map(contract => (
              <button
                key={contract.id}
                className="contract-card"
                onClick={() => onSelect(contract)}
              >
                <h3 className="contract-name">{contract.name}</h3>
                <div className="contract-stats">
                  <span>Volume: {formatVolume(contract.volumeBytes)}</span>
                  <span className="contract-stars">{renderStars(contract.multiplierStars)}</span>
                  <span className="contract-time">{getTimeRange(contract.multiplierStars)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
