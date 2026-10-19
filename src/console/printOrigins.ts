// The print gate (13 D12). A printed jar code is permanent, host included
// (12 D10), so real labels print only from an origin named here. Empty until
// ApiChain owns its domain: adding it is a one-line, reviewed commit, and the
// moment the /v/ link's host becomes permanent. Everywhere else every label
// is marked "SAMPLE: not for jars".
export const PRINT_ORIGINS: string[] = []

export function mayPrintLabels(origin: string): boolean {
  return PRINT_ORIGINS.includes(origin)
}
