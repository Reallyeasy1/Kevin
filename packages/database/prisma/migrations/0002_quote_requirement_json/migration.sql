-- INV-005: persist the exact accepts[] entry so the requirement can be rebuilt byte-identical after restart.
ALTER TABLE "Quote" ADD COLUMN "requirementJson" TEXT;
