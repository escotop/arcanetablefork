import { Component, For, JSX, Show } from "solid-js";
import {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { Deck } from "~/lib/constants";
import { getBracketColor, getBracketTagLabel } from "~/lib/commanderBracket";
import { getCommanderNames } from "~/lib/deckCommander";
import { IDENTITY_ORDER, type IdentityColor } from "~/lib/deckColorIdentity";
import { MANA_ICON_BY_BUCKET } from "~/lib/manaCost";
import { cn } from "~/lib/cnUtil";

export type BracketFilter = "all" | "none" | 1 | 2 | 3 | 4 | 5;

export const BRACKET_FILTER_OPTIONS: { value: BracketFilter; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: 1, label: getBracketTagLabel(1)! },
    { value: 2, label: getBracketTagLabel(2)! },
    { value: 3, label: getBracketTagLabel(3)! },
    { value: 4, label: getBracketTagLabel(4)! },
    { value: 5, label: getBracketTagLabel(5)! },
    { value: "none", label: "Unestimated" },
  ];

export function matchesBracketFilter(
  deck: Pick<Deck, "bracketEstimate"> | undefined,
  filter: BracketFilter,
) {
  if (filter === "all") return true;
  if (!deck) return false;
  if (filter === "none") return deck.bracketEstimate == null;
  return deck.bracketEstimate === filter;
}

export function matchesDeckSearch(
  deck: Pick<Deck, "name" | "inPlay"> | undefined,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (!deck) return false;

  if ((deck.name ?? "").toLowerCase().includes(normalized)) return true;

  const commanders = getCommanderNames(Object.values(deck.inPlay ?? {}));
  return commanders.some((name) => name.toLowerCase().includes(normalized));
}

export function matchesDeckPanelFilters(
  deck:
    | Pick<Deck, "bracketEstimate" | "name" | "inPlay" | "colorIdentity">
    | undefined,
  bracketFilter: BracketFilter,
  searchQuery: string,
  manaColors: readonly IdentityColor[] = [],
) {
  return (
    matchesBracketFilter(deck, bracketFilter) &&
    matchesDeckSearch(deck, searchQuery) &&
    matchesDeckManaFilter(deck, manaColors)
  );
}

type BracketOption = (typeof BRACKET_FILTER_OPTIONS)[number];

const MANA_FILTER_NAMES: Record<IdentityColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** Decks whose color identity has every selected color (AND). */
export function matchesDeckManaFilter(
  deck: Pick<Deck, "colorIdentity"> | undefined,
  colors: readonly IdentityColor[],
) {
  if (!colors.length) return true;
  const identity = deck?.colorIdentity ?? [];
  return colors.every((color) => identity.includes(color));
}

export const DeckBracketFilterBar: Component<{
  value: BracketFilter;
  onChange(filter: BracketFilter): void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchBarEnd?: JSX.Element;
  /** When given, shows the mana identity toggles next to the bracket dropdown. */
  manaColors?: IdentityColor[];
  onManaColorsChange?: (colors: IdentityColor[]) => void;
  class?: string;
}> = (props) => {
  const selectedOption = () =>
    BRACKET_FILTER_OPTIONS.find((option) => option.value === props.value) ??
    BRACKET_FILTER_OPTIONS[0];

  function toggleMana(color: IdentityColor) {
    const current = props.manaColors ?? [];
    props.onManaColorsChange?.(
      current.includes(color)
        ? current.filter((c) => c !== color)
        : [...current, color],
    );
  }

  return (
    <div class={`flex flex-wrap items-center gap-3 ${props.class ?? ""}`}>
      <Show when={props.onSearchChange}>
        <div class="flex min-w-[11rem] flex-1 basis-52 max-w-lg items-center gap-2">
          <TextField class="min-w-0 flex-1">
            <TextFieldInput
              type="search"
              placeholder="Search decks or commanders…"
              value={props.searchQuery ?? ""}
              onInput={(event) =>
                props.onSearchChange?.(event.currentTarget.value)
              }
              aria-label="Search decks"
            />
          </TextField>
          {props.searchBarEnd}
        </div>
      </Show>
      <div class="ml-auto flex flex-wrap items-center justify-end gap-3">
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted-foreground">Bracket</span>
          <Select<BracketOption>
            options={BRACKET_FILTER_OPTIONS}
            optionValue={(option) => String(option.value)}
            optionTextValue="label"
            value={selectedOption()}
            onChange={(option) => props.onChange(option?.value ?? "all")}
            disallowEmptySelection
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                <span class="flex items-center gap-2">
                  <Show
                    when={
                      itemProps.item.rawValue.value !== "all" &&
                      itemProps.item.rawValue.value !== "none"
                    }
                  >
                    <span
                      class="size-2.5 shrink-0 rounded-full"
                      style={{
                        "background-color": getBracketColor(
                          itemProps.item.rawValue.value as number,
                        ),
                      }}
                    />
                  </Show>
                  {itemProps.item.rawValue.label}
                </span>
              </SelectItem>
            )}
          >
            <SelectHiddenSelect />
            <SelectTrigger aria-label="Bracket" class="h-8 w-44 text-xs">
              <SelectValue<BracketOption>>
                {(state) => (
                  <span class="flex items-center gap-2 truncate">
                    <Show
                      when={
                        state.selectedOption()?.value !== "all" &&
                        state.selectedOption()?.value !== "none"
                      }
                    >
                      <span
                        class="size-2.5 shrink-0 rounded-full"
                        style={{
                          "background-color": getBracketColor(
                            state.selectedOption()?.value as number,
                          ),
                        }}
                      />
                    </Show>
                    {state.selectedOption()?.label ?? "All"}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
        <Show when={props.onManaColorsChange}>
          <div
            class="flex items-center gap-1"
            role="group"
            aria-label="Filter by colors"
          >
            <For each={IDENTITY_ORDER}>
              {(color) => {
                const active = () => props.manaColors?.includes(color) ?? false;
                return (
                  <button
                    type="button"
                    aria-pressed={active()}
                    aria-label={MANA_FILTER_NAMES[color]}
                    title={MANA_FILTER_NAMES[color]}
                    class={cn(
                      "rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active()
                        ? "opacity-100"
                        : "opacity-35 grayscale hover:opacity-70",
                    )}
                    onClick={() => toggleMana(color)}
                  >
                    <img
                      src={MANA_ICON_BY_BUCKET[color]}
                      alt=""
                      class="size-6"
                      draggable={false}
                    />
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
