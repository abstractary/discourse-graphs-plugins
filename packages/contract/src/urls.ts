/**
 * Two questions about an address that several layers ask, answered once.
 */

/** An address without the slashes at its end, so two spellings of one server compare equal. */
export const trimmedUrl = (url: string): string => url.replace(/\/+$/, "");

/**
 * Whether an address is on this computer. It is what decides that a paper's
 * text "stays on the device", so it is strict: the three names a computer has
 * for itself, with or without a port and a path, and nothing that merely
 * starts with one of them.
 */
export const isThisComputer = (url: string): boolean => /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(url.trim());
