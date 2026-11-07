// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { firstFree, usernameBase } from './usernames';

describe('noms d’utilisateur', () => {
  it.each([
    ['Aïssatou Diallo', 'aissatou.diallo'],
    ['  Jean-Pierre   Mendy ', 'jean-pierre.mendy'],
    ['Marie Claire Ndiaye', 'marie.ndiaye'],
    ['Zoé', 'zoe'],
    ['Œdipe Lætitia', 'oedipe.laetitia'],
    ["Fatou N'Diaye", 'fatou.ndiaye'],
    ['Ñuñez Çelik', 'nunez.celik'],
    ['安娜', 'eleve'],
    ['A', 'a0'],
  ])('%s → %s', (name, expected) => {
    expect(usernameBase(name)).toBe(expected);
  });

  it('suffixe numérique quand le nom est pris', () => {
    expect(firstFree('awa.ba', new Set())).toBe('awa.ba');
    expect(firstFree('awa.ba', new Set(['awa.ba']))).toBe('awa.ba2');
    expect(firstFree('awa.ba', new Set(['awa.ba', 'awa.ba2', 'awa.ba3']))).toBe('awa.ba4');
  });
});
