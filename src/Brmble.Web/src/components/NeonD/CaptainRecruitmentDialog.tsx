import { useEffect, useRef, useState } from 'react';
import styles from './NeonD.module.css';

type CaptainRecruitmentDialogProps = {
  defaultName: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
};

export function CaptainRecruitmentDialog({
  defaultName,
  onConfirm,
  onClose,
}: CaptainRecruitmentDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const trimmedName = name.trim();

  return (
    <div
      className={styles.captainRecruitmentBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.captainRecruitmentDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="captain-recruitment-title"
      >
        <h2 id="captain-recruitment-title" className="heading-title modal-title">Name your Captain</h2>
        <p className={styles.label}>Give your new Captain a name before recruiting him.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (trimmedName) onConfirm(trimmedName); }}>
          <label className={styles.captainRecruitmentField}>
            <span>Captain name</span>
            <input
              ref={inputRef}
              className="brmble-input"
              value={name}
              aria-label="Captain name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className={styles.captainRecruitmentActions}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel Captain naming
            </button>
            <button type="submit" className="btn btn-primary" disabled={!trimmedName}>
              Confirm Captain name
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
