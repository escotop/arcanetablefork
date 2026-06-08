import { createContext, useContext } from "solid-js";
import { CardSystem } from "./constants";
import { SetStoreFunction } from "solid-js/store";

interface CardSystemStore {
  systems: Record<string, CardSystem>;
  system: string;
}

export type CardSystemStoreContextType = [
  CardSystemStore,
  {
    update: SetStoreFunction<CardSystemStore>;
    setCardSystem(name: string): Promise<CardSystem>;
    initCardSystem(uri: string): Promise<CardSystem>;
  },
];

export const CardSystemContext = createContext<CardSystemStoreContextType>();

export function useCardSystemContext() {
  return useContext(CardSystemContext) as CardSystemStoreContextType;
}
