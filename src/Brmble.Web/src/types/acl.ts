export interface AclChannelSnapshot {
  channelId: number;
  inheritAcls: boolean;
  groups: AclGroup[];
  acls: AclRule[];
  fetchedAt: string;
  stale: boolean;
  warning: string | null;
  snapshotHash: string;
}

export interface AclGroup {
  name: string;
  inherited: boolean;
  inherit: boolean;
  inheritable: boolean;
  add: number[];
  remove: number[];
  members: number[];
}

export interface AclRule {
  applyHere: boolean;
  applySubs: boolean;
  inherited: boolean;
  userId: number | null;
  group: string | null;
  allow: number;
  deny: number;
}

export interface AclUpdateRequest {
  inheritAcls: boolean;
  groups: AclGroup[];
  acls: AclRule[];
  expectedSnapshotHash: string;
}

export const Permission = {
  Write: 0x01,
  Traverse: 0x02,
  Enter: 0x04,
  Speak: 0x08,
  MuteDeafen: 0x10,
  Move: 0x20,
  MakeChannel: 0x40,
  LinkChannel: 0x80,
  Whisper: 0x100,
  TextMessage: 0x200,
  MakeTempChannel: 0x400,
  Kick: 0x10000,
  Ban: 0x20000,
  Register: 0x40000,
  RegisterSelf: 0x80000,
  ResetUserContent: 0x100000,
} as const;
