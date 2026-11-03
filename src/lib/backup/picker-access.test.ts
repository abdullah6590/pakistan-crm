import { afterEach, describe, expect, it } from "vitest";
import { folderPickerAllowed } from "./picker-access";

const profile = process.env.CRM_DEPLOYMENT_PROFILE;
afterEach(() => {
  if (profile === undefined) delete process.env.CRM_DEPLOYMENT_PROFILE;
  else process.env.CRM_DEPLOYMENT_PROFILE = profile;
});

describe.runIf(process.platform === "win32")("folder picker on Windows", () => {
  it("desktop app and office server: always offered", () => {
    expect(folderPickerAllowed("192.168.1.20:3000", "device")).toBe(true);
    expect(folderPickerAllowed(null, "hub")).toBe(true);
  });

  it("website opened on the same PC (localhost): offered", () => {
    for (const host of ["localhost:3000", "LOCALHOST", "127.0.0.1:3000", "[::1]:3000"]) expect(folderPickerAllowed(host, "cloud")).toBe(true);
  });

  it("website opened from another PC, or the hosted online service: not offered (the window would open on the server)", () => {
    expect(folderPickerAllowed("192.168.1.20:3000", "cloud")).toBe(false);
    expect(folderPickerAllowed("crm.example.com", "cloud")).toBe(false);
    expect(folderPickerAllowed(null, "cloud")).toBe(false);
    process.env.CRM_DEPLOYMENT_PROFILE = "hosted-multi";
    expect(folderPickerAllowed("localhost:3000", "cloud")).toBe(false);
  });
});

describe.runIf(process.platform !== "win32")("folder picker elsewhere", () => {
  it("is never offered outside Windows", () => {
    expect(folderPickerAllowed("localhost:3000", "device")).toBe(false);
  });
});
