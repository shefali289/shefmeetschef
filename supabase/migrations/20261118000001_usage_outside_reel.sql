-- Task 2: outside reels count against a monthly allowance.
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it, so the new value
-- lives in its own migration and is first used in 20261118000002_usage_functions.sql.

alter type public.usage_kind add value if not exists 'outside_reel';
