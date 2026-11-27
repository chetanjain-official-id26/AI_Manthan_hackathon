-- Policy rules (LLD §3.3). Business limits live here, never in code.
INSERT INTO policy_rule (rule_code, category, city_tier, limit_amount, unit, action, flag, params, version, effective_from, reason) VALUES
 ('RECEIPT_REQUIRED',             NULL,    NULL,     500.00,  'PER_LINE',  'AUTO_REJECT', 'RECEIPT',    '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('DUPLICATE_RECEIPT_HASH',       NULL,    NULL,     NULL,    'NONE',      'ROUTE',       'DUPLICATE',  '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('DUPLICATE_VENDOR_AMOUNT_DATE', NULL,    NULL,     NULL,    'NONE',      'ROUTE',       'DUPLICATE',  '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('MEAL_DAILY_LIMIT',             'MEAL',  NULL,     1500.00, 'PER_DAY',   'ROUTE',       'OVER_LIMIT', '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('HOTEL_NIGHTLY_LIMIT',          'HOTEL', 'TIER_1', 6000.00, 'PER_NIGHT', 'ROUTE',       'OVER_LIMIT', '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('HOTEL_NIGHTLY_LIMIT',          'HOTEL', 'OTHER',  4000.00, 'PER_NIGHT', 'ROUTE',       'OVER_LIMIT', '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('CAB_TRIP_LIMIT',               'CAB',   NULL,     2000.00, 'PER_TRIP',  'ROUTE',       'OVER_LIMIT', '{}',                                  1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('WEEKEND_SPEND',                NULL,    NULL,     NULL,    'NONE',      'ROUTE',       'WEEKEND',    '{"weekendDays":["SATURDAY","SUNDAY"]}', 1, '2020-01-01T00:00:00+05:30', 'Initial seed'),
 ('STALE_EXPENSE',                NULL,    NULL,     NULL,    'NONE',      'ROUTE',       'STALE',      '{"maxAgeDays":90}',                   1, '2020-01-01T00:00:00+05:30', 'Initial seed (R6)');

-- Approval thresholds (LLD §3.4, ADR-001)
INSERT INTO approval_threshold (level, seq, min_total_exclusive, role, version, reason) VALUES
 ('MANAGER',      1, 0.00,      'MANAGER',      1, 'Initial seed'),
 ('AUDITOR',      2, 25000.00,  'AUDITOR',      1, 'Initial seed'),
 ('FINANCE_HEAD', 3, 100000.00, 'FINANCE_HEAD', 1, 'Initial seed');

-- Other config (LLD §3.3)
INSERT INTO app_config (config_key, config_value, version) VALUES
 ('auto_approve_max_total',          '5000.00', 1),
 ('sample_audit_rate',               '0.10',    1),
 ('split_window_days',               '7',       1),
 ('alternate_finance_approver_code', 'EMP0002', 1);
