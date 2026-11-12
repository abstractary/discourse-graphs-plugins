export type CaptureChoice = { id: string | null; label: string; key: string };

/**
 * One letter per node type, the same everywhere a selection becomes a unit:
 * the capture menu in a note and the highlight popup in a PDF. A clash falls
 * to the next free letter of the label.
 */
export const captureChoices = (
  types: { id: string; label: string; abbreviation?: string }[],
): CaptureChoice[] => {
  const taken = new Set<string>();
  const keyFor = (text: string): string => {
    for (const letter of text.toLowerCase()) {
      if (/[a-z]/.test(letter) && !taken.has(letter)) {
        taken.add(letter);
        return letter;
      }
    }
    return "";
  };
  return [
    ...types.map(({ id, label, abbreviation }) => ({ id, label, key: keyFor(`${abbreviation ?? ""}${label}`) })),
    { id: null, label: "No type yet", key: keyFor("no type") },
  ];
};
