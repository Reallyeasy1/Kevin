-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RouteMode" AS ENUM ('balanced', 'quality', 'cheapest', 'fastest');

-- CreateEnum
CREATE TYPE "RouteState" AS ENUM ('CLASSIFYING', 'ROUTING', 'NO_ELIGIBLE_OFFER', 'QUOTING', 'QUOTED', 'POLICY_APPROVED', 'POLICY_REJECTED', 'SIGNED', 'PAID_REQUEST_SENT', 'OUTCOME_UNKNOWN', 'VERIFYING', 'SUCCEEDED', 'PAID_EXECUTION_FAILED', 'PAYMENT_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "Eligibility" AS ENUM ('eligible', 'ineligible', 'selected', 'quote_rejected', 'not_quoted');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'POLICY_REJECTED', 'SIGNED', 'SENT', 'SETTLED', 'VALIDATED_FAILED', 'OUTCOME_UNKNOWN');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "mode" "RouteMode" NOT NULL,
    "maxCost" DECIMAL(20,6) NOT NULL,
    "assetCode" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "registryVersion" TEXT NOT NULL,
    "taskProfile" JSONB,
    "selectedOfferId" TEXT,
    "state" "RouteState" NOT NULL DEFAULT 'CLASSIFYING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteCandidate" (
    "routeId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "eligibility" "Eligibility" NOT NULL,
    "rejectionReasons" TEXT[],
    "qualityScore" DECIMAL(7,6) NOT NULL,
    "costScore" DECIMAL(7,6) NOT NULL,
    "latencyScore" DECIMAL(7,6) NOT NULL,
    "reliabilityScore" DECIMAL(7,6) NOT NULL,
    "finalScore" DECIMAL(7,6) NOT NULL,
    "estimatedCost" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "RouteCandidate_pkey" PRIMARY KEY ("routeId","offerId")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "assetCode" TEXT NOT NULL,
    "assetIssuer" TEXT,
    "network" TEXT NOT NULL,
    "rawRequirementHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "payerAddress" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "assetCode" TEXT NOT NULL,
    "transactionHash" TEXT,
    "signedTxBlob" TEXT,
    "lastLedgerSequence" INTEGER,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "ledgerIndex" INTEGER,
    "validatedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'pending',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "result" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_routeId_key" ON "Quote"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_invoiceId_key" ON "Quote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_routeId_key" ON "Payment"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_quoteId_key" ON "Payment"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceId_key" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionHash_key" ON "Payment"("transactionHash");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_routeId_key" ON "Execution"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_invoiceId_key" ON "Execution"("invoiceId");

-- AddForeignKey
ALTER TABLE "RouteCandidate" ADD CONSTRAINT "RouteCandidate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
