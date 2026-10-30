export const LEGACY_DRIVE_STORAGE_KEY = "crm_gdrive_state";

export function clearLegacyDriveCredentials(storage: Pick<Storage, "getItem" | "removeItem">) {
  if (storage.getItem(LEGACY_DRIVE_STORAGE_KEY) !== null) {
    storage.removeItem(LEGACY_DRIVE_STORAGE_KEY);
  }
}
