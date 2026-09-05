import { Component, For } from 'solid-js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { KEY } from '../constants';

const HotkeysTable: Component = props => {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Shortcut</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <ShortcutTable name='General Shortcuts' shortcuts={SHORTCUTS} />
        <ShortcutTable name='Battlefield Shortcuts' shortcuts={BATTLEFIELD_SHORTCUTS} />
        <ShortcutTable name='Card Search Overlay' shortcuts={OVERLAY_SHORTCUTS} />
      </TableBody>
    </Table>
  );
};

export default HotkeysTable;

const ShortcutTable: Component<{ name: string; shortcuts: typeof SHORTCUTS }> = props => {
  return (
    <>
      <TableRow>
        <TableHead colSpan={2}>{props.name}</TableHead>
      </TableRow>
      <For each={props.shortcuts}>
        {entry => (
          <TableRow>
            <TableCell style='white-space: nowrap;'>{entry.action}</TableCell>
            <TableCell>
              <div style='display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;'>
                <For each={entry.shortcuts}>
                  {(keys, i) => (
                    <span style='display: flex; gap: 0.5rem; align-items: center;'>
                      <kbd class='flex select-none items-center gap-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium'>
                        <For each={keys}>
                          {(key, i) => <>{key + (i() < keys.length - 1 ? ' ' : '')}</>}
                        </For>
                      </kbd>
                      {i() < entry.shortcuts.length - 1 && <span>or</span>}
                    </span>
                  )}
                </For>
              </div>
            </TableCell>
          </TableRow>
        )}
      </For>
    </>
  );
};

export const SHORTCUTS = [
  { shortcuts: [['shift', 'R']], action: 'Untap all cards' },
  { shortcuts: [['D']], action: 'Draw a card' },
  { shortcuts: [['space']], action: 'Pass turn' },
  { shortcuts: [['esc']], action: 'Close zoom panel and clear selection' },
  { shortcuts: [['F1']], action: 'Return to your camera view' },
  { shortcuts: [['F2'], ['F3'], ['F4']], action: "View from another player's perspective" },
  { shortcuts: [['`']], action: 'Toggle camera debug controls (dev)' },
  { shortcuts: [['+'], ['=']], action: 'Increase +1/+1 on hovered battlefield card' },
  { shortcuts: [['-']], action: 'Decrease +1/+1 on hovered battlefield card' },
  {
    shortcuts: [
      ['ctrl', 'space'],
      [KEY.Mod, 'K'],
    ],
    action: 'Open Command Palette',
  },
  {
    shortcuts: [[KEY.Mod, 'D']],
    action: 'discard selected cards',
  },
  {
    shortcuts: [[KEY.Mod, 'E']],
    action: 'remove selected cards from the game',
  },
  {
    shortcuts: [[KEY.Mod, 'F']],
    action: 'transfer to field',
  },
  {
    shortcuts: [[KEY.Shift, 'T']],
    action: 'transfer to top of deck',
  },
  {
    shortcuts: [[KEY.Shift, 'B']],
    action: 'transfer to bottom of deck',
  },
  {
    shortcuts: [[KEY.Shift, 'C']],
    action: 'clone card',
  },
  {
    shortcuts: [['S']],
    action: 'search your deck',
  },
  {
    shortcuts: [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0']],
    action: 'zoom a card in your hand (1 = leftmost, 0 = 10th). Press again to dismiss',
  },
  {
    shortcuts: [['←'], ['→']],
    action: 'cycle hand zoom left/right (wraps). Shows first card if none selected',
  },
];

export const BATTLEFIELD_SHORTCUTS = [
  { shortcuts: [['T']], action: 'show Spanish printing while hovering a card' },
  { shortcuts: [['C']], action: 'clone selected cards' },
  { shortcuts: [['F']], action: 'flip selected cards' },
];

export const OVERLAY_SHORTCUTS = [{ shortcuts: [['esc']], action: 'close overlay' }];
