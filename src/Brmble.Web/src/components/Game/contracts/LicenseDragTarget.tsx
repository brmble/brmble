import { useState } from 'react';
import { Service, Contract } from '../types';
import './LicenseDragTarget.css';

interface LicenseDragTargetProps {
  license: Service;
  onDrop: (licenseId: string) => void;
}

export function LicenseDragTarget({ license, onDrop }: LicenseDragTargetProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    onDrop(license.id);
  };

  return (
    <div
      className={`license-drag-target ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="drag-target-label">{license.name}</span>
      {isDragOver && <span className="drag-hint">Drop here</span>}
    </div>
  );
}