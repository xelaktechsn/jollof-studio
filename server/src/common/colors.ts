// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { randomInt } from 'node:crypto';

export const AVATAR_COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#264653', '#8ab17d', '#457b9d', '#9b5de5', '#f15bb5', '#00a6a6'];
export const CLASS_COLORS = ['#2a9d8f', '#e76f51', '#457b9d', '#f4a261', '#9b5de5', '#8ab17d'];
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const pick = <T>(list: T[]): T => list[randomInt(list.length)];
