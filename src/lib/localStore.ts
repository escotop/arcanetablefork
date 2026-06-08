import { onMount } from "solid-js";
import { createStore, SetStoreFunction, unwrap } from "solid-js/store";


export function createLocalStore<T extends object>(key: string, defaults: T) {
  const [state, setState] = createStore<T>(defaults)

  onMount(() => {
    let savedState = localStorage.getItem(key);
    if (savedState && savedState.length) {
      setState(JSON.parse(savedState));
    }
  })

  const updateState: SetStoreFunction<T> = (...args: any[]) => {
    let result = setState(...args);
    localStorage.setItem(key, JSON.stringify(unwrap(state)))
    return result;
  }

  return [state, updateState];
}
