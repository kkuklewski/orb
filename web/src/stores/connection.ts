import { create } from "zustand";

export type Connection = "connecting" | "online" | "offline" | "refused" | "no-token";

export const useConnection = create<{ state: Connection; set: (s: Connection) => void }>((set) => ({
  state: "connecting",
  set: (state) => set({ state }),
}));
