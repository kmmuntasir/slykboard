// Shared localStorage key for the persisted auth store AND the cross-tab logout
// BroadcastChannel name. Single source of truth — see useAuthStore (persist name)
// and useCrossTabLogout (channel + storage-event match).
export const AUTH_STORAGE_KEY = 'slyk-auth';
