import { expect, test } from 'vitest';
import { card, deck, parseImportedCardList } from './deckParser';

test('card', () => {
  let run = card.run('1x Alela, Artful Provocateur (brc) 119 [Tokens]');

  expect(run.isError).toBe(false);

  expect.soft(run.result).toMatchInlineSnapshot(`
    {
      "categories": [
        "Tokens",
      ],
      "collector_number": "119",
      "name": "Alela, Artful Provocateur",
      "qty": 1,
      "set": "brc",
    }
  `);

  expect.soft(card.run('1x Al')).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 5,
      "isError": false,
      "result": {
        "categories": null,
        "collector_number": undefined,
        "name": "Al",
        "qty": 1,
        "set": undefined,
      },
    }
  `);
});

test('deck', () => {
  expect.soft(
    deck.run(`
1x Alela, Artful Provocateur (brc) 119 [Tokens]
1x All That Glitters (cmm) 622 [Pump]
1x Angelic Destiny (woc) 60 [Evasion]
1x Anguished Unmaking (pip) 473 [Removal]
1x Arcane Sanctum (moc) 390 [Land]
1x Archangel of Thune (m14) 5 [Lifegain]
1x Ardenn, Intrepid Archaeologist (cmr) 10 [Ramp]
1x Athreos, God of Passage (plst) JOU-146 [Recursion]
1x Avacyn, Angel of Hope (avr) 6 [Protection]
1x Bojuka Bog (blc) 294 [Land]    `).result,
  ).toMatchInlineSnapshot(`
    [
      {
        "categories": [
          "Tokens",
        ],
        "collector_number": "119",
        "name": "Alela, Artful Provocateur",
        "qty": 1,
        "set": "brc",
      },
      {
        "categories": [
          "Pump",
        ],
        "collector_number": "622",
        "name": "All That Glitters",
        "qty": 1,
        "set": "cmm",
      },
      {
        "categories": [
          "Evasion",
        ],
        "collector_number": "60",
        "name": "Angelic Destiny",
        "qty": 1,
        "set": "woc",
      },
      {
        "categories": [
          "Removal",
        ],
        "collector_number": "473",
        "name": "Anguished Unmaking",
        "qty": 1,
        "set": "pip",
      },
      {
        "categories": [
          "Land",
        ],
        "collector_number": "390",
        "name": "Arcane Sanctum",
        "qty": 1,
        "set": "moc",
      },
      {
        "categories": [
          "Lifegain",
        ],
        "collector_number": "5",
        "name": "Archangel of Thune",
        "qty": 1,
        "set": "m14",
      },
      {
        "categories": [
          "Ramp",
        ],
        "collector_number": "10",
        "name": "Ardenn, Intrepid Archaeologist",
        "qty": 1,
        "set": "cmr",
      },
      {
        "categories": [
          "Recursion",
        ],
        "collector_number": undefined,
        "name": "Athreos, God of Passage",
        "qty": 1,
        "set": "plst",
      },
      {
        "categories": [
          "Protection",
        ],
        "collector_number": "6",
        "name": "Avacyn, Angel of Hope",
        "qty": 1,
        "set": "avr",
      },
      {
        "categories": [
          "Land",
        ],
        "collector_number": "294",
        "name": "Bojuka Bog",
        "qty": 1,
        "set": "blc",
      },
    ]
  `);
});

test('deck', () => {
  expect.soft(
    deck.run(`
1x Underworld Coinsmith (jou) 157 [Maybeboard{noDeck}{noPrice},Lifegain]
1x Vampiric Link (plc) 92 [Lifegain]
1x Vow of Duty (c21) 110 [Removal]
1x Winds of Rath (mkc) 93 [Removal]
1x Zur the Enchanter (dmr) 206 [Commander{top}] `).result,
  ).toMatchInlineSnapshot(`
    [
      {
        "categories": [
          "Maybeboard{noDeck}{noPrice}",
          "Lifegain",
        ],
        "collector_number": "157",
        "name": "Underworld Coinsmith",
        "qty": 1,
        "set": "jou",
      },
      {
        "categories": [
          "Lifegain",
        ],
        "collector_number": "92",
        "name": "Vampiric Link",
        "qty": 1,
        "set": "plc",
      },
      {
        "categories": [
          "Removal",
        ],
        "collector_number": "110",
        "name": "Vow of Duty",
        "qty": 1,
        "set": "c21",
      },
      {
        "categories": [
          "Removal",
        ],
        "collector_number": "93",
        "name": "Winds of Rath",
        "qty": 1,
        "set": "mkc",
      },
      {
        "categories": [
          "Commander{top}",
        ],
        "collector_number": "206",
        "name": "Zur the Enchanter",
        "qty": 1,
        "set": "dmr",
      },
    ]
  `);
});

test('mtgo format', () => {
  expect.soft(
    deck.run(`1 Altar of the Pantheon [THB] (F)
1 Arcane Signet [M3C]
1 Archangel Avacyn [SOI]
1 Arlinn Kord [SOI]`),
  ).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 100,
      "isError": false,
      "result": [
        {
          "categories": [],
          "collector_number": undefined,
          "name": "Altar of the Pantheon",
          "qty": 1,
          "set": "thb",
        },
        {
          "categories": [],
          "collector_number": undefined,
          "name": "Arcane Signet",
          "qty": 1,
          "set": "m3c",
        },
        {
          "categories": [],
          "collector_number": undefined,
          "name": "Archangel Avacyn",
          "qty": 1,
          "set": "soi",
        },
        {
          "categories": [],
          "collector_number": undefined,
          "name": "Arlinn Kord",
          "qty": 1,
          "set": "soi",
        },
      ],
    }
  `);
});

test('mtga format', () => {
  expect.soft(
    deck.run(`1 Barkchannel Pathway <prerelease> [KHM] (F)
1 Beast Whisperer <magic 30> [DMU]`),
  ).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 79,
      "isError": false,
      "result": [
        {
          "categories": [
            "prerelease",
          ],
          "collector_number": undefined,
          "name": "Barkchannel Pathway",
          "qty": 1,
          "set": "khm",
        },
        {
          "categories": [
            "magic 30",
          ],
          "collector_number": undefined,
          "name": "Beast Whisperer",
          "qty": 1,
          "set": "dmu",
        },
      ],
    }
  `);
});

test('mtga extended', () => {
  expect.soft(card.run(`1 Beast Whisperer <magic 30> [DMU]`)).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 34,
      "isError": false,
      "result": {
        "categories": [
          "magic 30",
        ],
        "collector_number": undefined,
        "name": "Beast Whisperer",
        "qty": 1,
        "set": "dmu",
      },
    }
  `);
});

test('mtg.wtf', () => {
  expect.soft(
    deck.run(`// NAME: Hare Raising - Bloomburrow Starter Kit
// URL: http://mtg.wtf/deck/blb/hare-raising
// DATE: 2024-08-02
1 Byrke, Long Ear of the Law [BLB:380] [foil]
1 Serra Redeemer [BLB:387]
1 Colossification [BLB:392]
`),
  ).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 214,
      "isError": false,
      "result": [
        {
          "categories": [],
          "collector_number": "380",
          "name": "Byrke, Long Ear of the Law",
          "qty": 1,
          "set": "blb",
        },
        {
          "categories": [],
          "collector_number": "387",
          "name": "Serra Redeemer",
          "qty": 1,
          "set": "blb",
        },
        {
          "categories": [],
          "collector_number": "392",
          "name": "Colossification",
          "qty": 1,
          "set": "blb",
        },
      ],
    }
  `);
});

test('edhrec clipboard', () => {
  expect.soft(card.run('Test')).toMatchInlineSnapshot(`
    {
      "data": null,
      "index": 4,
      "isError": false,
      "result": {
        "categories": null,
        "collector_number": undefined,
        "name": "Test",
        "qty": 1,
        "set": undefined,
      },
    }
  `);
});

test('card with set and collector number', () => {
  expect(card.run('1 Orcish Bowmasters [ltr] #433').result).toEqual({
    qty: 1,
    name: 'Orcish Bowmasters',
    set: 'ltr',
    categories: [],
    collector_number: '433',
  });
});

test('card with bracket set and bare collector number', () => {
  expect(card.run('1 Diregraf Captain [scd] 224').result).toEqual({
    qty: 1,
    name: 'Diregraf Captain',
    set: 'scd',
    categories: [],
    collector_number: '224',
  });
});

test('card with paren set and collector number', () => {
  expect(card.run('1 Diregraf Captain (scd) 224').result).toEqual({
    qty: 1,
    name: 'Diregraf Captain',
    set: 'scd',
    categories: null,
    collector_number: '224',
  });

  expect(card.run('1 Diregraf Captain (SCD) 224').result).toMatchObject({
    set: 'scd',
    collector_number: '224',
  });

  expect(card.run('1 Diregraf Captain (scd) #224').result).toMatchObject({
    set: 'scd',
    collector_number: '224',
  });
});

test('arena format deck with paren set and bare collector number', () => {
  const result = deck.run(`1 Swiftfoot Boots (FDN) 258
1 The Scarab God (DRC) 120
1 Tormod, the Desecrator (CMR) 155
1 Undead Augur (DRC) 100
1 Undead Warchief (SCG) 78`).result;

  expect(result).toEqual([
    {
      qty: 1,
      name: 'Swiftfoot Boots',
      set: 'fdn',
      categories: null,
      collector_number: '258',
    },
    {
      qty: 1,
      name: 'The Scarab God',
      set: 'drc',
      categories: null,
      collector_number: '120',
    },
    {
      qty: 1,
      name: 'Tormod, the Desecrator',
      set: 'cmr',
      categories: null,
      collector_number: '155',
    },
    {
      qty: 1,
      name: 'Undead Augur',
      set: 'drc',
      categories: null,
      collector_number: '100',
    },
    {
      qty: 1,
      name: 'Undead Warchief',
      set: 'scg',
      categories: null,
      collector_number: '78',
    },
  ]);
});

test('parseImportedCardList ignores Deck and marks Commander for start in play', () => {
  const result = parseImportedCardList(`Deck
4 Lightning Bolt
Commander
1x Alela, Artful Provocateur (brc) 119
1 Sol Ring (cmr) 472`);

  expect(result.cards).toHaveLength(3);
  expect(result.cards[0].name).toBe('Lightning Bolt');
  expect(result.cards[0].qty).toBe(4);
  expect(result.cards[1].name).toBe('Alela, Artful Provocateur');
  expect(result.cards[2].name).toBe('Sol Ring');
  expect(result.inPlayIndices).toEqual([1]);
});
