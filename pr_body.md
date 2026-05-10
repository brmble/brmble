## Summary

Fixed TTS voice dropdown selection persistence and flickering issues by:
- Adding `TtsVoice` persistence to the settings model
- Implementing voice signature-based change detection to prevent unnecessary re-renders
- Memoizing voice options to ensure stable object references across renders

## Problem

The TTS voice dropdown was:
1. Not persisting the selected voice across sessions
2. Flickering/re-rendering on every voice list update
3. Losing selection state when voices were reloaded

## Solution

### Backend Changes (AppSettings.cs)
- Added `string TtsVoice = ""` field to `MessagesSettings` record to persist voice selection across sessions

### Frontend Changes (MessagesSettingsTab.tsx)

1. **Voice Signature Detection**: Implemented a signature-based approach to detect actual changes in the voice list:
   - Creates a signature from voice properties (name, language, default status)
   - Only updates state when the signature changes, preventing spurious re-renders
   - Uses `voiceSignatureRef` to track the last known signature

2. **Memoized Voice Options**: Used `useMemo` to memoize voice options:
   - Ensures object reference stability across renders
   - Prevents unnecessary Select component re-renders
   - Dependencies limited to `voices` array

3. **Selection Auto-Recovery**: When TTS is enabled without a voice selected, automatically selects the first available voice (via existing logic)

## Testing

- [x] Voice selection persists across settings close/reopen
- [x] Dropdown no longer flickers when voices list loads
- [x] Default voice selection works correctly
- [x] Existing TTS functionality unaffected

## Technical Details

### Files Changed

1. **src/Brmble.Client/Services/AppConfig/AppSettings.cs**
   - Added `string TtsVoice = ""` to `MessagesSettings` record
   - Enables persistent storage of user's TTS voice preference

2. **src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx**
   - Added imports: `useRef`, `useMemo`
   - Added `voiceSignatureRef` to track voice list state
   - Modified `loadVoices()` to use signature-based detection
   - Wrapped voice options in `useMemo` to prevent re-creation
   - Maintains backward compatibility with existing TTS features

### Key Implementation Details

**Voice Signature Approach:**
```javascript
const signature = availableVoices
  .map(v => `${v.name}|${v.lang}|${v.default ? 1 : 0}`)
  .join('||');
if (signature !== voiceSignatureRef.current) {
  voiceSignatureRef.current = signature;
  setVoices(availableVoices);
}
```
This prevents state updates when voices haven't actually changed, reducing unnecessary renders.

**Memoized Options:**
```javascript
const ttsVoiceOptions = useMemo(
  () => [
    { value: '', label: 'Default' },
    ...voices.map(voice => ({ value: voice.name, label: voice.name })),
  ],
  [voices]
);
```
Ensures the options array is only recreated when the voices list changes.

## Impact

- **User Experience**: Voice selection is now stable and persistent
- **Performance**: Eliminated unnecessary re-renders when voice lists load
- **Data Persistence**: TTS voice preference survives application restarts
- **Compatibility**: No breaking changes to existing functionality

**Stats:**
- Files changed: 2
- Insertions: +19
- Deletions: -6
