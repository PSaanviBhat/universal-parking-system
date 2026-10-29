-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFUND';

-- AlterTable
ALTER TABLE "ParkingSession" ADD COLUMN     "resolutionNote" TEXT;
