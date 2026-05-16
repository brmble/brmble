import { Tooltip } from '../Tooltip/Tooltip';

interface SettingsHelpProps {
  content: string;
  label: string;
}

export function SettingsHelp({ content, label }: SettingsHelpProps) {
  return (
    <Tooltip content={content} position="right" align="start">
      <button type="button" className="settings-info-btn" aria-label={label}>?</button>
    </Tooltip>
  );
}
