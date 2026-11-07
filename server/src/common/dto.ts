// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { Transform } from 'class-transformer';

/** Retire les espaces autour d'une chaîne avant validation. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** Minuscule + espaces retirés (courriels, noms d'utilisateur). */
export const Lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
/** Paramètre de requête « true »/« false » → booléen. */
export const QueryBool = () => Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value));
