import { createContext, ParentProps, useContext } from 'solid-js';
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '~/components/ui/dropdown-menu';
import {
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarPortal,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '~/components/ui/menubar';

const Context = createContext<MenuContext>();

export const DropdownMenuElements = {
  type: 'dropdown',
  item: DropdownMenuItem,
  separator: DropdownMenuSeparator,
  menu: DropdownMenuSub,
  shortcut: DropdownMenuShortcut,
  trigger: DropdownMenuSubTrigger,
  content: (props: Parameters<typeof DropdownMenuSubContent>[0])=> (
    <DropdownMenuPortal>
      <DropdownMenuSubContent {...props} />
    </DropdownMenuPortal>
  ),
} as const;

export const MenubarElements = {
  type: 'menubar',
  item: MenubarItem,
  separator: MenubarSeparator,
  shortcut: MenubarShortcut,
  menu: MenubarMenu,
  trigger: MenubarTrigger,
  content: MenubarContent,
} as const;

export type MenuContext = typeof MenubarElements | typeof DropdownMenuElements;

export function MenuContextProvider(props: ParentProps & { components: MenuContext }) {
  return <Context.Provider value={props.components}>{props.children}</Context.Provider>;
}

export function useMenuContext() {
  const context = useContext(Context);

  if (!context) throw new Error('useMenuContext must be used inside of a MenuContextProvider');

  return context;
}
