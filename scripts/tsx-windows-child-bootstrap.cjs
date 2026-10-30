// The tsx launcher asks for os.userInfo() on Windows because Node does not expose geteuid there.
// Some locked-down Windows service accounts cannot resolve a profile and return ENOMEM. A numeric temp suffix is
// sufficient and avoids that unrelated profile lookup before crash-safety child tests reach application code.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  Object.defineProperty(process, "geteuid", { value: () => 0 });
}
