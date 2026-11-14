import { createContext, useContext } from "react";

/**
 * Where a panel is showing. The Library is one panel wherever it is: beside the app in a sidebar,
 * or inside a canvas's own sidebar. Inside a canvas it knows which canvas is on screen, and opening
 * another one changes that canvas in place.
 */
export type Place = {
  /** The canvas on screen, when the panel sits inside one. */
  current?: string;
  /** Opens a canvas from here. Absent, the base opens it. */
  go?: (canvas: string) => void;
};

export const PlaceContext = createContext<Place>({});
export const usePlace = (): Place => useContext(PlaceContext);
