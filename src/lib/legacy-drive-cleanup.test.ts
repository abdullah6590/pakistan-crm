import { describe, expect, it } from "vitest";
import { clearLegacyDriveCredentials } from "./legacy-drive-cleanup";

describe("legacy browser Drive credentials", () => {
  it("removes the historical localStorage record containing the access token", () => {
    const values = new Map([["crm_gdrive_state", JSON.stringify({ accessToken: "secret" })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    };

    clearLegacyDriveCredentials(storage);

    expect(values.has("crm_gdrive_state")).toBe(false);
  });
});
