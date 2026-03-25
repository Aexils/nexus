export type NexusUser = 'alexis' | 'marion';

export interface UserProfile {
  id: NexusUser;
  displayName: string;
  avatarInitial: string;
}

export const USER_PROFILES: UserProfile[] = [
  { id: 'alexis', displayName: 'Alexis',  avatarInitial: 'A' },
  { id: 'marion', displayName: 'Marion',  avatarInitial: 'M' },
];
