# Profile Tab Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the separate "Profile" and "Profiles" settings tabs into a single unified "Profile" tab with avatar, profile dropdown, and profile management sections.

**Architecture:** Rewrite `ProfileSettingsTab` to incorporate `useProfiles` hook and absorb all profile management UI from `ProfilesSettingsTab`. Remove the standalone Profiles tab from `SettingsModal`. Pure frontend refactor — no backend changes.

**Tech Stack:** React, TypeScript, CSS (design tokens from `docs/UI_GUIDE.md`)

---

### Task 1: Rewrite ProfileSettingsTab to Consolidated Layout

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.css`

**Step 1: Rewrite ProfileSettingsTab.tsx**

Replace the entire file with the consolidated component. The new component has three sections:

1. **Avatar** — kept from current ProfileSettingsTab (unchanged)
2. **Profile** — dropdown to switch active profile (replaces old Certificate section)
3. **Manage Profiles** — profile list, inline add/edit forms, per-profile actions (migrated from ProfilesSettingsTab)

```tsx
import { useState, useEffect, useRef } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import bridge from '../../bridge';
import { useProfiles } from '../../hooks/useProfiles';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import './ProfileSettingsTab.css';

interface ProfileSettingsTabProps {
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
  connected: boolean;
}

function getAvatarStatusText(user: ProfileSettingsTabProps['currentUser']): string {
  if (!user.avatarUrl) return 'Default';
  if (user.avatarUrl.startsWith('mxc://') || user.avatarUrl.includes('/_matrix/')) {
    return 'Uploaded';
  }
  return 'From Mumble';
}

function triggerBlobDownload(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProfileSettingsTab({ currentUser, onUploadAvatar, onRemoveAvatar, connected }: ProfileSettingsTabProps) {
  const [showUpload, setShowUpload] = useState(false);
  const { profiles, activeProfileId, loading, addProfile, importProfile, removeProfile, renameProfile, setActive, exportCert } = useProfiles();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusText = getAvatarStatusText(currentUser);

  // Certificate export handler
  useEffect(() => {
    const onExportData = (data: unknown) => {
      const d = data as { data: string; filename: string } | undefined;
      if (d?.data) triggerBlobDownload(d.data, d.filename ?? 'brmble-identity.pfx');
    };
    bridge.on('cert.exportData', onExportData);
    return () => bridge.off('cert.exportData', onExportData);
  }, []);

  // Cancel forms on Escape
  useEffect(() => {
    if (!isAdding && !editingId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAdding(false);
        setEditingId(null);
        setAddName('');
        setEditName('');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAdding, editingId]);

  const getInitial = (name: string) => (name?.charAt(0) || '?').toUpperCase();

  const truncateFingerprint = (fp: string | null) => {
    if (!fp) return 'No certificate';
    if (fp.length <= 20) return fp;
    return fp.slice(0, 8) + '...' + fp.slice(-8);
  };

  const handleAddGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    addProfile(name);
    setAddName('');
    setIsAdding(false);
  };

  const handleAddImport = () => {
    const name = addName.trim();
    if (!name) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = addName.trim();
    if (!name) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach(b => (binary += String.fromCharCode(b)));
      importProfile(name, btoa(binary));
      setAddName('');
      setIsAdding(false);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    renameProfile(editingId, name);
    setEditingId(null);
    setEditName('');
  };

  const handleEditStart = (profile: { id: string; name: string }) => {
    setEditingId(profile.id);
    setEditName(profile.name);
    setIsAdding(false);
  };

  const handleDelete = async (profile: { id: string; name: string }) => {
    const confirmed = await confirm({
      title: 'Delete profile',
      message: `Remove "${profile.name}"? The certificate file will remain on disk and can be re-imported later.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (confirmed) removeProfile(profile.id);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setAddName('');
    setEditName('');
  };

  return (
    <div className="profile-settings-tab">
      {/* Avatar section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Avatar</h3>
        <div className="profile-avatar-section">
          <Avatar user={currentUser} size={80} />
          <div className="profile-avatar-info">
            <span className="profile-display-name">{currentUser.name}</span>
            <span className="profile-display-name-hint">Set by Mumble registration</span>
            <span className="profile-avatar-status">{statusText}</span>
          </div>
          {connected ? (
            <div className="profile-avatar-actions">
              <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload</button>
              {currentUser.avatarUrl && (
                <button className="btn btn-secondary" onClick={onRemoveAvatar}>Remove</button>
              )}
            </div>
          ) : (
            <span className="profile-avatar-hint">Connect to a server to change your avatar</span>
          )}
        </div>
      </div>

      {/* Profile dropdown section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Profile</h3>
        <div className="settings-item">
          <label>Active Profile</label>
          <Tooltip content={connected ? 'Disconnect to switch profiles' : 'Select your active profile'}>
            <select
              className="brmble-input profile-select"
              value={activeProfileId ?? ''}
              onChange={(e) => setActive(e.target.value)}
              disabled={connected || loading || profiles.length === 0}
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {profiles.length === 0 && (
                <option value="">No profiles</option>
              )}
            </select>
          </Tooltip>
        </div>
      </div>

      {/* Manage Profiles section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Manage Profiles</h3>

        {/* Hidden file input for certificate import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pfx,.p12"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {!loading && profiles.length > 0 ? (
          <div className="profiles-items">
            {profiles.map((profile, index) => {
              const isActive = profile.id === activeProfileId;

              if (editingId === profile.id) {
                return (
                  <form key={profile.id} className="profiles-form" onSubmit={handleEditSubmit}>
                    <h3 className="heading-section profiles-form-title">Rename Profile</h3>
                    <div className="profiles-form-fields">
                      <input
                        className="brmble-input profiles-input"
                        placeholder="Profile Name"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="profiles-form-actions">
                      <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={!editName.trim()}>
                        Save
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div
                  key={profile.id}
                  className={`profiles-item${isActive ? ' profiles-item-active' : ''}`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="profiles-icon">
                    {getInitial(profile.name)}
                  </div>
                  <div className="profiles-info">
                    <span className="profiles-name">{profile.name}</span>
                    <span className="profiles-fingerprint">{truncateFingerprint(profile.fingerprint)}</span>
                    {isActive && <span className="profiles-active-badge">Active</span>}
                  </div>
                  <div className="profiles-actions">
                    <Tooltip content="Rename profile">
                      <button
                        className="btn btn-secondary profiles-action-btn"
                        onClick={() => handleEditStart(profile)}
                      >
                        Edit
                      </button>
                    </Tooltip>
                    <Tooltip content="Export certificate">
                      <button
                        className="btn btn-secondary profiles-action-btn"
                        onClick={() => exportCert()}
                      >
                        Export
                      </button>
                    </Tooltip>
                    <Tooltip content="Delete profile">
                      <button
                        className="btn btn-ghost profiles-delete-btn"
                        onClick={() => handleDelete(profile)}
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        ) : !loading ? (
          <div className="profiles-empty">
            <div className="profiles-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <p>No profiles yet</p>
            <p className="profiles-empty-hint">Create a profile to manage multiple identities</p>
          </div>
        ) : null}

        {isAdding && (
          <form className="profiles-form" onSubmit={handleAddGenerate}>
            <h3 className="heading-section profiles-form-title">Add New Profile</h3>
            <div className="profiles-form-fields">
              <input
                className="brmble-input profiles-input"
                placeholder="Profile Name"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="profiles-form-actions">
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleAddImport} disabled={!addName.trim()}>
                Import Certificate
              </button>
              <button type="submit" className="btn btn-primary" disabled={!addName.trim()}>
                Generate New Certificate
              </button>
            </div>
          </form>
        )}

        {!isAdding && !editingId && (
          <button className="btn btn-ghost profiles-add-btn" onClick={() => setIsAdding(true)}>
            <span className="profiles-add-icon">+</span>
            Add Profile
          </button>
        )}
      </div>

      {showUpload && (
        <AvatarUpload
          onUpload={(blob, contentType) => {
            onUploadAvatar(blob, contentType);
            setShowUpload(false);
          }}
          onCancel={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
```

Key changes from current `ProfileSettingsTab`:
- Removed `fingerprint` and `connectedUsername` props (no longer needed)
- Removed Certificate section (fingerprint display, server username)
- Removed old Manage section (global export/import)
- Added `useProfiles` hook import and usage
- Added profile dropdown in new "Profile" section
- Added full profile list + forms in new "Manage Profiles" section (migrated from `ProfilesSettingsTab`)
- Removed `Activate` button from profile items (dropdown handles switching now)
- `Export` button shown on all profiles (not just active — user may want to export any cert)

**Step 2: Update ProfileSettingsTab.css**

Add the profile dropdown style. The profiles-* CSS classes are already in `ProfilesSettingsTab.css` which we'll import:

Add to the end of `ProfileSettingsTab.css`:

```css
.profile-select {
  min-width: 200px;
}
```

**Step 3: Import ProfilesSettingsTab.css into ProfileSettingsTab.tsx**

Add this import at the top of the rewritten `ProfileSettingsTab.tsx` (already included in the code above — but we need to add the CSS import):

```tsx
import '../SettingsModal/ProfilesSettingsTab.css';
```

Wait — since both files are in the same directory, this is simply:

```tsx
import './ProfilesSettingsTab.css';
```

Add this import alongside the existing `./ProfileSettingsTab.css` import.

**Step 4: Build frontend to verify no TS errors**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.css
git commit -m "refactor: consolidate Profile and Profiles tabs into single Profile tab"
```

---

### Task 2: Remove Profiles Tab from SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Remove ProfilesSettingsTab import**

Remove line 12:
```tsx
import { ProfilesSettingsTab } from './ProfilesSettingsTab';
```

**Step 2: Remove 'profiles' from tab type**

Change line 76 from:
```tsx
const [activeTab, setActiveTab] = useState<'profile' | 'profiles' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
```
to:
```tsx
const [activeTab, setActiveTab] = useState<'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
```

**Step 3: Remove Profiles tab button**

Remove the Profiles tab button (lines 308-313):
```tsx
          <button
            className={`settings-tab ${activeTab === 'profiles' ? 'active' : ''}`}
            onClick={() => setActiveTab('profiles')}
          >
            Profiles
          </button>
```

**Step 4: Remove Profiles tab content**

Remove the profiles tab content rendering (lines 358-360):
```tsx
          {activeTab === 'profiles' && (
            <ProfilesSettingsTab connected={props.connected ?? false} />
          )}
```

**Step 5: Update ProfileSettingsTab props**

The ProfileSettingsTab no longer needs `fingerprint` and `connectedUsername` props. Update the rendering:

Change from:
```tsx
            <ProfileSettingsTab
              currentUser={props.currentUser ?? { name: props.username ?? 'Unknown' }}
              onUploadAvatar={props.onUploadAvatar ?? (() => {})}
              onRemoveAvatar={props.onRemoveAvatar ?? (() => {})}
              fingerprint={props.certFingerprint ?? ''}
              connectedUsername={props.username ?? ''}
              connected={props.connected ?? false}
            />
```

To:
```tsx
            <ProfileSettingsTab
              currentUser={props.currentUser ?? { name: props.username ?? 'Unknown' }}
              onUploadAvatar={props.onUploadAvatar ?? (() => {})}
              onRemoveAvatar={props.onRemoveAvatar ?? (() => {})}
              connected={props.connected ?? false}
            />
```

**Step 6: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "refactor: remove standalone Profiles tab from SettingsModal"
```

---

### Task 3: Clean Up Unused Props from SettingsModalProps

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Remove `certFingerprint` from SettingsModalProps**

The `certFingerprint` prop is no longer consumed by any child. Check if it's still used elsewhere in the component before removing.

If it's only used for the old `ProfileSettingsTab` fingerprint prop (which was removed in Task 2), remove it from the interface:

```tsx
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
  // certFingerprint removed
  connected?: boolean;
  currentUser?: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar?: (blob: Blob, contentType: string) => void;
  onRemoveAvatar?: () => void;
}
```

**Step 2: Find and update all call sites passing certFingerprint**

Search for `certFingerprint` in the codebase. Update any `<SettingsModal>` usage in `App.tsx` or elsewhere to stop passing this prop.

**Step 3: Build frontend**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove unused certFingerprint prop from SettingsModal"
```

---

### Task 4: Build Verification

**Step 1: TypeScript check**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors

**Step 2: Vite build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeded

**Step 3: Backend build (sanity check)**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Run all tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v n`
Expected: 52 tests pass

**Step 5: Verify clean git status**

Run: `git status`
Expected: Clean working tree
