import { useState, useEffect } from 'react';
import type { ActiveContract, Service, Contract } from '../types';
import './ContractSlot.css';

interface ContractSlotProps {
  index: number;
  activeContract: ActiveContract | null;
  pendingContract: Contract | null;
  license: Service | null;
  unlocked: boolean;
  onAddContract: () => void;
  onCollect: () => void;
  onCancel: () => void;
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

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ContractSlot({ index, activeContract, pendingContract, license, unlocked, onAddContract, onCollect, onCancel }: ContractSlotProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [incomePerSecond, setIncomePerSecond] = useState(0);
  
  useEffect(() => {
    if (!license) return;
    setIncomePerSecond(license.baseIncomePerSecond * license.owned);
  }, [license]);
  
  useEffect(() => {
    if (!activeContract) return;
    
    const updateTime = () => {
      const elapsedSeconds = (Date.now() - activeContract.startTime) / 1000;
      const remaining = Math.max(0, activeContract.timeLimitSeconds - elapsedSeconds);
      setRemainingSeconds(remaining);
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [activeContract?.startTime, activeContract?.timeLimitSeconds]);

  const handleDragStart = (e: React.DragEvent) => {
    if (pendingContract) {
      setIsDragging(true);
      e.dataTransfer.setData('contract-slot', String(index));
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  if (!unlocked) {
    return (
      <div className="contract-slot locked">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="slot-locked">Locked</span>
      </div>
    );
  }

  if (!activeContract && !pendingContract) {
    return (
      <div className="contract-slot empty">
        <span className="slot-label">Slot {index + 1}</span>
        <button className="btn btn-primary btn-sm" onClick={onAddContract}>
          + Add Contract
        </button>
      </div>
    );
  }

  if (!activeContract && pendingContract) {
    return (
      <div 
        className={`contract-slot pending ${isDragging ? 'dragging' : ''}`}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="slot-header">
          <span className="slot-label">Slot {index + 1}</span>
          <button className="btn btn-ghost btn-xs slot-cancel" onClick={onCancel}>×</button>
        </div>
        <div className="pending-body">
          <div className="drag-handle">
            <span className="drag-dots">⋮⋮</span>
          </div>
          <div className="pending-content">
            <span className="pending-name">{pendingContract.name}</span>
            <span className="pending-volume">{formatVolume(pendingContract.volumeBytes)}</span>
          </div>
        </div>
        <div className="pending-hint">
          <span className="hint-icon">↔</span> Drag to a license to activate
        </div>
      </div>
    );
  }

  // At this point, activeContract is guaranteed to be non-null
  const ac = activeContract!;
  
  const progress = (ac.volumeFilledBytes / ac.volumeBytes) * 100;
  const isComplete = progress >= 100 || remainingSeconds <= 0;
  const earned = isComplete ? (ac.volumeFilledBytes / ac.volumeBytes) * incomePerSecond * 10 : 0;

  return (
    <div className={`contract-slot active ${isComplete ? 'complete' : ''}`}>
      <div className="slot-header">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="contract-stars">{renderStars(ac.multiplierStars)}</span>
      </div>
      
      <div className="slot-timer">
        <span className={`timer-value ${remainingSeconds < 60 ? 'urgent' : ''}`}>
          {formatTime(remainingSeconds)}
        </span>
        <span className="timer-progress">
          {progress.toFixed(0)}%
        </span>
      </div>
      
      <div className="contract-progress-bar">
        <div className="contract-progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      
      <div className="slot-footer">
        <span className="volume-info">
          {formatVolume(ac.volumeFilledBytes)} / {formatVolume(ac.volumeBytes)}
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
