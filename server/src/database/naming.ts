// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

// userAId → user_a_id (majuscules consécutives séparées aussi).
const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/** Colonnes en snake_case côté PostgreSQL, propriétés en camelCase côté code. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? snake(className);
  }
  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]): string {
    return snake([...prefixes, customName ?? propertyName].join('_'));
  }
  override relationName(propertyName: string): string {
    return snake(propertyName);
  }
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }
}
