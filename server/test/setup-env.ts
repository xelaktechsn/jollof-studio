// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Environnement des tests e2e : base jollof_test (vidée entre les suites), bcrypt rapide.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://jollof:jollof@localhost:5433/jollof_test';
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'e2e-only-secret-0123456789abcdefghijklmnopqrstuvwxyz';
process.env.BCRYPT_COST = '4';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.PLATFORM_KEY = 'e2e-platform-key';
process.env.TRIAL_DAYS = '30';
process.env.TRUST_PROXY = 'false';
delete process.env.CORS_ORIGINS;
