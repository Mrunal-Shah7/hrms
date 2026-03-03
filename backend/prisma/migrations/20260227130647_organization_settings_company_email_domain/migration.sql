/*
  Warnings:

  - Added the required column `updated_at` to the `billing_records` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "registration_requests_slug_key";

-- AlterTable
ALTER TABLE "billing_records" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "company_email_domain" VARCHAR(255);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_format" VARCHAR(20),
    "timezone" VARCHAR(50),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "profile_picture_visibility" VARCHAR(20) NOT NULL DEFAULT 'everyone',
    "new_sign_in_alert" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
