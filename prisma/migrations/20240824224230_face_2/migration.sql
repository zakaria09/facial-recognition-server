/*
  Warnings:

  - You are about to drop the column `faceDetails` on the `Image` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Image" DROP COLUMN "faceDetails";

-- CreateTable
CREATE TABLE "Faces" (
    "faceId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "boundingBox" JSONB NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Faces_faceId_key" ON "Faces"("faceId");

-- AddForeignKey
ALTER TABLE "Faces" ADD CONSTRAINT "Faces_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "Image"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
