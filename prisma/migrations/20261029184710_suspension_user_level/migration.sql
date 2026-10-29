-- DropForeignKey
ALTER TABLE "SuspensionRecord" DROP CONSTRAINT "SuspensionRecord_vehicleId_fkey";

-- AlterTable
ALTER TABLE "SuspensionRecord" ALTER COLUMN "vehicleId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SuspensionRecord" ADD CONSTRAINT "SuspensionRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
