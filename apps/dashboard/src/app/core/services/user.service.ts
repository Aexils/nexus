import { Injectable, signal } from '@angular/core';
import { NexusUser, USER_PROFILES, UserProfile } from '@nexus/shared-types';

const STORAGE_KEY = 'nexus-user';

@Injectable({ providedIn: 'root' })
export class UserService {
  readonly currentUser = signal<NexusUser>(
    (localStorage.getItem(STORAGE_KEY) as NexusUser | null) ?? 'alexis',
  );

  readonly profiles: UserProfile[] = USER_PROFILES;

  get currentProfile(): UserProfile {
    return USER_PROFILES.find(p => p.id === this.currentUser()) ?? USER_PROFILES[0];
  }

  setUser(user: NexusUser): void {
    this.currentUser.set(user);
    localStorage.setItem(STORAGE_KEY, user);
  }
}
