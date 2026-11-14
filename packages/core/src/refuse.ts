import type { HostErrorCode, Result } from "@dg/contract/host.ts";
import type { HostRef } from "@dg/contract/records.ts";

/**
 * A failure that says what kind it is. A panel can act on the code: offer to open the existing
 * unit on `conflict`, say who may on `read-only`. Anything thrown without one reaches a panel as
 * `invalid`.
 */
export class Refusal extends Error {
  code: HostErrorCode;
  ref?: HostRef;
  constructor(code: HostErrorCode, message: string, ref?: HostRef) {
    super(message);
    this.name = "Refusal";
    this.code = code;
    if (ref !== undefined) this.ref = ref;
  }
}

export const refuse = (code: HostErrorCode, message: string): Refusal => new Refusal(code, message);

/** What a base answered, or a refusal carrying the base's own code. */
export const value = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Refusal(result.error.code, `${result.error.code}: ${result.error.message}`, result.error.ref);
  return result.value;
};

export const codeOf = (error: unknown): HostErrorCode => (error instanceof Refusal ? error.code : "invalid");
